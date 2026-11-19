import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DigikuntzDirectChargeError } from '../errors/direct-charge.errors';
import type { DirectChargeOperator } from '../utils/mobile-money.util';
import { normalizeDigikuntzStatus } from '../../../common/utils/digikuntz-status.util';

export interface DirectChargeInput {
  estimation: number;
  userPhone: string;
  userEmail?: string;
  userCountry?: string;
  senderName: string;
  paymentMethodCode: DirectChargeOperator;
  callbackUrl?: string;
  raisonForTransfer?: string;
  idempotencyKey?: string;
}

/** Résultat strictement interne au service : jamais le corps brut fournisseur. */
export interface DirectChargeResult {
  providerRef: string;
  transactionRef?: string;
  paymentWithTaxes?: number;
  invoiceTaxes?: number;
  paymentMethodCode?: string;
  refused: boolean;
  paymentLink?: string;
  refusalReason?: string;
}

const PROVIDER_CODE_PATTERN = /^[A-Za-z0-9_]{1,50}$/;
const REFUSAL_REASON_PATTERN = /^[A-Z_]{1,50}$/;

/**
 * 409 d'idempotence : la requête initiale est encore en cours (ou son effet de
 * bord a eu lieu mais la réponse a été perdue). Ce n'est JAMAIS un refus
 * définitif : un remboursement ou un nouveau paiement serait dangereux.
 * Hérite de ServiceUnavailableException pour que le flux payin le classe
 * comme issue inconnue (et non comme échec).
 */
export class DigikuntzIdempotencyInProgressError extends ServiceUnavailableException {
  constructor() {
    super('Request with this Idempotency-Key is still in progress');
  }
}

const IDEMPOTENCY_CONFLICT_CODES = new Set([
  'IDEMPOTENCY_IN_PROGRESS',
  'IDEMPOTENCY_KEY_IN_PROGRESS',
  'REQUEST_IN_PROGRESS',
  'DUPLICATE_REQUEST',
]);

const BUSINESS_CONFLICT_CODES = new Set([
  'INSUFFICIENT_BALANCE',
  'INVALID_PHONE',
  'INVALID_AMOUNT',
  'INVALID_ACCOUNT',
  'INVALID_NUMBER',
  'NOT_ALLOWED',
  'FORBIDDEN',
]);

function providerErrorCode(body: string): string | null {
  try {
    const parsed: any = JSON.parse(String(body || ''));
    const code = parsed?.errors?.[0]?.code ?? parsed?.code ?? parsed?.errorCode;
    return typeof code === 'string' ? code.toUpperCase() : null;
  } catch {
    return null;
  }
}

function isBusinessConflict(body: string) {
  // Priorité au code structuré s'il est fourni ; le texte n'est qu'un repli.
  const code = providerErrorCode(body);
  if (code) {
    if (IDEMPOTENCY_CONFLICT_CODES.has(code) || code.includes('IDEMPOTENCY')) {
      return false;
    }
    if (BUSINESS_CONFLICT_CODES.has(code) || code.startsWith('INVALID_')) {
      return true;
    }
    // Code inconnu : on retombe sur le texte, avec une liste volontairement
    // restrictive (un libellé ambigu ne doit pas déclencher un remboursement).
  }
  return /insufficient balance|invalid (?:phone|amount|account|number|bank)|not allowed|forbidden/i.test(
    String(body || ''),
  );
}

function isIdempotencyInProgress(status: number, body: string) {
  // Tout 409 non explicitement métier est ambigu (clé encore en cours,
  // corps vide/HTML via proxy, changement de libellé provider). On le traite
  // comme « en cours », jamais comme un refus.
  return status === 409 && !isBusinessConflict(body);
}

@Injectable()
export class DigikuntzProvider {
  private readonly logger = new Logger(DigikuntzProvider.name);
  private readonly baseUrl = process.env.DIGIKUNTZ_BASE_URL;
  private readonly userId = process.env.DIGIKUNTZ_USER_ID;
  private readonly secretKey = process.env.DIGIKUNTZ_API_KEY;
  // Timeout serré pour ne pas bloquer un encaissement client lorsque DigiKuntz
  // ne répond pas. Au-delà → ServiceUnavailableException = gateway indisponible.
  private readonly requestTimeoutMs = Number(process.env.DIGIKUNTZ_REQUEST_TIMEOUT_MS || 12000);

  private get headers() {
    return {
      'Content-Type': 'application/json',
      'x-user-id': this.userId,
      'x-secret-key': this.secretKey,
    };
  }

  private headersWithIdempotency(idempotencyKey?: string) {
    const base = this.headers;
    if (!idempotencyKey) return base;
    return { ...base, 'Idempotency-Key': idempotencyKey.slice(0, 255) };
  }

  /**
   * Exécute une requête fetch avec timeout. Toute erreur réseau (DNS, refus
   * de connexion, abort) est convertie en `ServiceUnavailableException` pour
   * que les consommateurs (encaissement, retrait) puissent identifier
   * uniformément l'indisponibilité du gateway.
   */
  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error: any) {
      throw new ServiceUnavailableException(
        'Service de paiement temporairement indisponible. Réessayez dans quelques minutes.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Demande de paiement mobile money direct. Ne lève que `DigikuntzDirectChargeError` :
   * - `rejected` : DigiKuntz a refusé la demande, rien n'est débité ;
   * - `unknown` : issue inconnue (timeout, 5xx, réseau, réponse illisible) : ne jamais supprimer le paiement.
   * Le corps brut n'est jamais renvoyé ni inclus dans un message.
   */
  async initiateDirectCharge(input: DirectChargeInput): Promise<DirectChargeResult> {
    const { status, ok, json } = await this.postDirectCharge({
      estimation: input.estimation,
      currency: 'XAF',
      userPhone: input.userPhone,
      userEmail: input.userEmail ?? '',
      userCountry: input.userCountry || 'Cameroon',
      senderName: input.senderName,
      paymentMethodCode: input.paymentMethodCode,
      callbackUrl: input.callbackUrl ?? '',
      raisonForTransfer: input.raisonForTransfer ?? 'Payment',
    }, { idempotencyKey: input.idempotencyKey });

    if (!ok) throw this.classifyDirectChargeFailure(status, json);
    return this.parseDirectChargeSuccess(json);
  }

  private async postDirectCharge(
    body: Record<string, unknown>,
    options?: { idempotencyKey?: string },
  ): Promise<{ status: number; ok: boolean; json: any }> {
    // Aucune requête n'est partie si la configuration est absente : c'est un rejet certain, pas une issue inconnue.
    if (!this.baseUrl) {
      this.logger.error('DIGIKUNTZ_BASE_URL is not configured — direct charge not sent');
      throw new DigikuntzDirectChargeError('rejected');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/dev/direct-charge`, {
        method: 'POST',
        headers: this.headersWithIdempotency(options?.idempotencyKey),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      return { status: res.status, ok: res.ok, json: this.parseJsonSafely(text) };
    } catch {
      // Réseau, DNS, abort (timeout) pendant l'envoi ou la lecture : la demande peut avoir été reçue.
      throw new DigikuntzDirectChargeError('unknown');
    } finally {
      clearTimeout(timer);
    }
  }

  private parseJsonSafely(text: string): any {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private classifyDirectChargeFailure(status: number, body: any): DigikuntzDirectChargeError {
    const rawCode = body?.errors?.[0]?.code;
    const providerCode = typeof rawCode === 'string' && PROVIDER_CODE_PATTERN.test(rawCode) ? rawCode : undefined;
    this.logger.warn(`DigiKuntz direct charge HTTP ${status}${providerCode ? ` (${providerCode})` : ''}`);

    if (status === 503 && providerCode === 'DIRECT_CHARGE_DISABLED') {
      return new DigikuntzDirectChargeError('rejected', providerCode, status);
    }
    // 409 = clé d'idempotence déjà en cours / conflit fournisseur : l'issue est
    // ambiguë. Ne jamais le classer comme un rejet certain, sinon le service
    // créerait un nouveau paiement alors que la demande précédente peut aboutir.
    if (status === 409) {
      return new DigikuntzDirectChargeError('unknown', providerCode, status);
    }
    const isClientError = status >= 400 && status < 500 && status !== 408 && status !== 429;
    if (isClientError) return new DigikuntzDirectChargeError('rejected', providerCode, status);
    return new DigikuntzDirectChargeError('unknown', providerCode, status);
  }

  private parseDirectChargeSuccess(json: any): DirectChargeResult {
    if (!json || typeof json !== 'object' || !json.id) {
      this.logger.warn('DigiKuntz direct charge returned an unreadable 2xx response');
      throw new DigikuntzDirectChargeError('unknown');
    }

    const data = json.data && typeof json.data === 'object' ? json.data : {};
    // Code de refus contrôlé (ex. DIRECT_CHARGE_REFUSED) : tout texte libre fournisseur est écarté.
    const rawReason = data.fallback?.reason;
    const refusalReason = typeof rawReason === 'string' && REFUSAL_REASON_PATTERN.test(rawReason) ? rawReason : undefined;
    const refused = data.chargeStatus === 'failed' || refusalReason === 'DIRECT_CHARGE_REFUSED';
    const paymentLink = data.paymentLink ?? data.redirect_url;

    return {
      providerRef: String(json.id),
      transactionRef: data.transactionRef,
      paymentWithTaxes: data.paymentWithTaxes,
      invoiceTaxes: data.invoiceTaxes,
      paymentMethodCode: typeof data.paymentMethodCode === 'string' ? data.paymentMethodCode : undefined,
      refused,
      paymentLink: typeof paymentLink === 'string' ? paymentLink : undefined,
      refusalReason,
    };
  }

  async initiatePayment(
    orderNumber: string,
    amount: number,
    userPhone?: string,
    userEmail?: string,
    options?: { idempotencyKey?: string },
  ) {
    const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    const callbackUrl = frontendUrl ? `${frontendUrl}/orders` : '';
    const res = await this.fetchWithTimeout(`${this.baseUrl}/dev/transaction`, {
      method: 'POST',
      headers: this.headersWithIdempotency(options?.idempotencyKey),
      body: JSON.stringify({
        estimation: amount,
        raisonForTransfer: `Commande ${orderNumber}`,
        userEmail: userEmail ?? '',
        userPhone: userPhone ?? '',
        userCountry: 'Cameroon',
        senderName: orderNumber,
        ...(callbackUrl ? { callbackUrl } : {}),
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw this.buildHostedPaymentError(res, errorBody);
    }

    const data = await this.readJsonResponse(res, 'DigiKuntz payment');
    return {
      providerRef: data.id,
      transactionRef: data.data?.transactionRef,
      amount: data.data?.estimation,
      paymentWithTaxes: data.data?.paymentWithTaxes,
      invoiceTaxes: data.data?.invoiceTaxes,
      paymentLink: data.data?.paymentLink,
      status: data.status,
    };
  }

  async getTransactionStatus(transactionId: string): Promise<{ id: string; status: string; data: any } | null> {
    return this.fetchTransaction(`/dev/transaction?transactionId=${encodeURIComponent(transactionId)}`);
  }

  /**
   * Variante par `transactionRef` (ex: `IN958#260617135017`). À privilégier
   * pour les polls : la référence est stable, lisible et indexée côté
   * DigiKuntz, et la route source-of-truth est dédiée aux apiPayouts.
   */
  async getTransactionStatusByRef(transactionRef: string): Promise<{ id: string; status: string; data: any } | null> {
    if (!transactionRef) return null;
    return this.fetchTransaction(`/dev/transaction-by-ref?transactionRef=${encodeURIComponent(transactionRef)}`);
  }

  /**
   * État d'un payout via la route documentée `/dev/api-payouts` (fallback
   * lorsque les routes de statut de transaction ne couvrent pas les payouts).
   * La liste est paginée ; on cherche par `_id` (providerRef) ou
   * `transactionRef` dans la première page.
   */
  async getPayoutStatus(input: {
    providerRef?: string;
    transactionRef?: string;
  }): Promise<{ id: string; status: string; data: any } | null> {
    try {
      // La doc expose une liste paginée : on parcourt un nombre borné de pages
      // plutôt que de supposer que le payout est dans la première.
      for (let page = 1; page <= 5; page += 1) {
        const res = await this.fetchWithTimeout(
          `${this.baseUrl}/dev/api-payouts?page=${page}&limit=20`,
          { method: 'GET', headers: this.headers },
        );
        if (!res.ok) {
          this.logger.warn(`DigiKuntz payouts list HTTP ${res.status}`);
          return null;
        }

        const body: any = await res.json().catch(() => null);
        const items = Array.isArray(body?.data) ? body.data : [];
        const match = items.find((item: any) => {
          if (input.providerRef && String(item?._id) === String(input.providerRef)) return true;
          if (input.transactionRef && item?.transactionRef === input.transactionRef) return true;
          return false;
        });
        if (match) {
          return {
            id: String(match._id),
            status: normalizeDigikuntzStatus(match.status) || String(match.status || ''),
            data: match,
          };
        }
        if (!body?.pagination?.hasNextPage) break;
      }
      return null;
    } catch (error: any) {
      this.logger.warn(
        `Unable to list DigiKuntz payouts: ${error?.message || error}`,
      );
      return null;
    }
  }

  /**
   * Lecture d'une transaction avec timeout (`requestTimeoutMs`). Cron/webhook : tout échec → `null`.
   */
  private async fetchTransaction(path: string): Promise<{ id: string; status: string; data: any } | null> {
    try {
      return await this.fetchTransactionOrThrow(path);
    } catch {
      return null;
    }
  }

  /**
   * Variante stricte pour le chemin de requête client (réutilisation d'un paiement direct) :
   * tout échec (timeout, réseau, réponse non OK, corps invalide) lève `unknown`, jamais `null`.
   * Un statut inconnu ne doit JAMAIS conduire à une nouvelle demande de paiement.
   */
  async getTransactionStatusOrThrow(transactionId: string): Promise<{ id: string; status: string; data: any }> {
    try {
      return await this.fetchTransactionOrThrow(
        `/dev/transaction?transactionId=${encodeURIComponent(transactionId)}`,
      );
    } catch (error) {
      if (error instanceof DigikuntzDirectChargeError) throw error;
      throw new DigikuntzDirectChargeError('unknown');
    }
  }

  private async fetchTransactionOrThrow(path: string): Promise<{ id: string; status: string; data: any }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: this.headers,
        signal: controller.signal,
      });
      if (!res.ok) throw new DigikuntzDirectChargeError('unknown', undefined, res.status);
      // DigiKuntz peut renvoyer une chaîne brute (« Unauthorized », « no
      // transaction found »…) en cas de mismatch credentials/scopes. On ne
      // valide la réponse qu'à condition qu'elle ait la forme `{id, status}`.
      const body: any = await res.json().catch(() => null);
      if (!body || typeof body !== 'object' || !body.status) {
        throw new DigikuntzDirectChargeError('unknown', undefined, res.status);
      }
      // Les listes / historique renvoient `transaction_payin_*` alors que les GET
      // unitaires renvoient `payin_*` : on normalise systématiquement.
      return { ...body, status: normalizeDigikuntzStatus(body.status)! };
    } catch (error) {
      if (error instanceof DigikuntzDirectChargeError) throw error;
      throw new DigikuntzDirectChargeError('unknown');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Erreur du flux hébergé : aucun corps fournisseur dans le message (jamais exposé au client).
   * Les 5xx / 408 / 429 restent une indisponibilité, comme avant.
   */
  private buildHostedPaymentError(res: Response, rawBody = '') {
    if (isIdempotencyInProgress(res.status, rawBody)) {
      return new DigikuntzIdempotencyInProgressError();
    }
    const isUnavailable = res.status >= 500 || res.status === 408 || res.status === 429;
    if (isUnavailable) {
      return new ServiceUnavailableException(
        'Service de paiement temporairement indisponible. Réessayez dans quelques minutes.',
      );
    }
    this.logger.warn(`DigiKuntz hosted payment HTTP ${res.status}`);
    return new InternalServerErrorException('Le paiement n’a pas pu être initié. Réessayez ou contactez le support.');
  }

  async initiatePayout(input: {
    amount: number;
    phone: string;
    accountBankCode: 'MTN' | 'ORANGEMONEY';
    receiverName: string;
    narration: string;
    callbackUrl?: string;
    idempotencyKey?: string;
  }) {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/dev/payout`, {
      method: 'POST',
      headers: this.headersWithIdempotency(input.idempotencyKey),
      body: JSON.stringify({
        amount: input.amount,
        accountBankCode: input.accountBankCode,
        accountNumber: input.phone,
        receiverName: input.receiverName,
        currency: 'XAF',
        narration: input.narration,
        ...(input.callbackUrl ? { callbackUrl: input.callbackUrl } : {}),
      }),
    });

    if (!res.ok) {
      throw this.buildProviderError(res, await res.text(), 'DigiKuntz payout');
    }

    const data = await this.readJsonResponse(res, 'DigiKuntz payout');
    return {
      providerRef: data.id,
      transactionRef: data.data?.transactionRef,
      amount: data.data?.estimation,
      paymentWithTaxes: data.data?.paymentWithTaxes,
      invoiceTaxes: data.data?.invoiceTaxes,
      status: data.status,
      raw: data,
    };
  }

  private async readJsonResponse(res: Response, context: string) {
    try {
      return await res.json();
    } catch {
      throw new ServiceUnavailableException(`${context} returned an invalid response`);
    }
  }

  private buildProviderError(res: Response, rawBody: string, context: string) {
    const body = String(rawBody || '');
    if (isIdempotencyInProgress(res.status, body)) {
      return new DigikuntzIdempotencyInProgressError();
    }
    const isHtml = /<\/?[a-z][\s\S]*>/i.test(body);
    const title = body.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.trim();
    const safeDetail = isHtml ? title : body.slice(0, 300);
    // 5xx (et 408/429) sont considérés comme indisponibilité du gateway.
    // Les autres 4xx restent des erreurs métier propagées telles quelles.
    const isUnavailable = res.status >= 500 || res.status === 408 || res.status === 429;
    const message = isUnavailable
      ? 'Service de paiement temporairement indisponible. Réessayez dans quelques minutes.'
      : `${context} error${safeDetail ? `: ${safeDetail}` : ''}`;

    if (isUnavailable) return new ServiceUnavailableException(message);
    return new InternalServerErrorException(message);
  }
}
