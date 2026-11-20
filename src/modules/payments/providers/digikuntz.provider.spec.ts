import { DigikuntzDirectChargeError } from '../errors/direct-charge.errors';
import { DigikuntzProvider } from './digikuntz.provider';

const BASE_URL = 'https://digikuntz.test/dev';

const baseInput = {
  estimation: 4200,
  userPhone: '650123456',
  userEmail: 'payer@example.com',
  userCountry: 'Cameroon',
  senderName: 'Jean Dupont',
  paymentMethodCode: 'MTN' as const,
  callbackUrl: 'https://app.test/orders',
  raisonForTransfer: 'Commande ORD-1',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const acceptedBody = {
  id: '6af3b70df7bdee716adaa851',
  status: 'payin_pending',
  data: {
    estimation: '4200',
    transactionRef: 'IN535#261111013004',
    invoiceTaxes: '5',
    paymentWithTaxes: '4410',
    currency: 'XAF',
    paymentMethodCode: 'MTN',
  },
};

const refusedBody = {
  id: '6af3b037d39740d6da4a0ce4',
  status: 'payin_pending',
  data: {
    estimation: '4200',
    transactionRef: 'IN401#261111010055',
    paymentMethodCode: 'ORANGEMONEY',
    paymentLink: 'https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-XXXX',
    redirect_url: 'https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-XXXX',
    chargeStatus: 'failed',
    fallback: { from: 'direct', reason: 'DIRECT_CHARGE_REFUSED' },
  },
};

describe('DigikuntzProvider.initiateDirectCharge', () => {
  let provider: DigikuntzProvider;
  let fetchSpy: jest.SpyInstance;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.DIGIKUNTZ_BASE_URL = BASE_URL;
    process.env.DIGIKUNTZ_USER_ID = 'user-id';
    process.env.DIGIKUNTZ_API_KEY = 'secret-key';
    process.env.DIGIKUNTZ_REQUEST_TIMEOUT_MS = '12000';
    provider = new DigikuntzProvider();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    process.env = { ...originalEnv };
  });

  async function captureError(promise: Promise<unknown>): Promise<any> {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error('expected rejection');
  }

  describe('succès', () => {
    it('envoie le format de référence : currency XAF, téléphone local, sans paymentMethodCode ni callbackUrl', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(201, acceptedBody));

      await provider.initiateDirectCharge({ ...baseInput, paymentMethodCode: 'ORANGEMONEY' });

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/dev/direct-charge`);
      expect(init.method).toBe('POST');
      const sent = JSON.parse(init.body as string);
      expect(sent.currency).toBe('XAF');
      expect(sent.paymentMethodCode).toBeUndefined();
      expect(sent.callbackUrl).toBeUndefined();
      expect(sent.userPhone).toBe('650123456');
      expect(sent.estimation).toBe(4200);
    });

    it('n’envoie plus MTN par défaut quand paymentMethodCode est absent du contrat', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(201, acceptedBody));

      await provider.initiateDirectCharge({ ...baseInput, paymentMethodCode: undefined as any });

      const sent = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      expect(sent.paymentMethodCode).toBeUndefined();
    });

    it('retourne les références sans refus et sans renvoyer le corps brut', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(201, acceptedBody));

      const result = await provider.initiateDirectCharge(baseInput);

      expect(result).toEqual(
        expect.objectContaining({
          providerRef: '6af3b70df7bdee716adaa851',
          transactionRef: 'IN535#261111013004',
          paymentWithTaxes: '4410',
          invoiceTaxes: '5',
          paymentMethodCode: 'MTN',
          refused: false,
          paymentLink: undefined,
        }),
      );
      expect(result).not.toHaveProperty('raw');
    });
  });

  describe('refus (201 avec fallback)', () => {
    it('chargeStatus failed + fallback DIRECT_CHARGE_REFUSED → refused=true et paymentLink', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(201, refusedBody));

      const result = await provider.initiateDirectCharge(baseInput);

      expect(result.refused).toBe(true);
      expect(result.paymentLink).toBe('https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-XXXX');
      expect(result.refusalReason).toBe('DIRECT_CHARGE_REFUSED');
      expect(result).not.toHaveProperty('raw');
    });

    it('utilise redirect_url si paymentLink est absent', async () => {
      const body = { ...refusedBody, data: { ...refusedBody.data, paymentLink: undefined } };
      fetchSpy.mockResolvedValueOnce(jsonResponse(201, body));

      const result = await provider.initiateDirectCharge(baseInput);

      expect(result.paymentLink).toBe('https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-XXXX');
    });

    it('chargeStatus failed seul suffit pour un refus', async () => {
      const body = { ...refusedBody, data: { ...refusedBody.data, fallback: undefined } };
      fetchSpy.mockResolvedValueOnce(jsonResponse(201, body));

      const result = await provider.initiateDirectCharge(baseInput);

      expect(result.refused).toBe(true);
    });
  });

  describe('rejet certain (4xx)', () => {
    it.each([
      ['NO_ACTIVE_PAYIN_METHOD', 400],
      ['INVALID_PHONE', 400],
      ['NETWORK_NOT_RESOLVED', 400],
      ['AMBIGUOUS_NUMBER', 400],
      ['AMOUNT_BELOW_MIN', 400],
      ['AMOUNT_EXCEEDS_MAX', 400],
      ['LIMIT_EXCEEDED', 400],
      ['METHOD_NOT_FOUND', 404],
      ['CURRENCY_MISMATCH', 400],
      ['METHOD_DISABLED', 400],
    ])('%s (HTTP %i) → rejected avec providerCode', async (code, status) => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(status, { status: 'error', errors: [{ code, status, meaning: 'x' }] }),
      );

      const error = await captureError(provider.initiateDirectCharge(baseInput));

      expect(error).toBeInstanceOf(DigikuntzDirectChargeError);
      expect(error.kind).toBe('rejected');
      expect(error.providerCode).toBe(code);
      expect(error.httpStatus).toBe(status);
    });

    it('ne propage jamais le corps brut (HTML ou texte) dans le message', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(400, '<html><title>SECRET-BODY</title><body>token=abc</body></html>'),
      );

      const error = await captureError(provider.initiateDirectCharge(baseInput));

      expect(error.kind).toBe('rejected');
      expect(error.providerCode).toBeUndefined();
      expect(error.message).not.toMatch(/SECRET-BODY|token=|<html/i);
    });
  });

  describe('503 DIRECT_CHARGE_DISABLED', () => {
    it('→ rejected (aucun débit)', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(503, { errors: [{ code: 'DIRECT_CHARGE_DISABLED', status: 503 }] }),
      );

      const error = await captureError(provider.initiateDirectCharge(baseInput));

      expect(error.kind).toBe('rejected');
      expect(error.providerCode).toBe('DIRECT_CHARGE_DISABLED');
    });
  });

  describe('issue inconnue (unknown)', () => {
    it.each([
      ['502 (upstream, code n/a)', 502, { errors: [{ code: 'n/a', status: 502 }] }],
      ['500', 500, {}],
      ['504', 504, {}],
      ['408', 408, {}],
      ['429', 429, {}],
      ['503 sans code', 503, {}],
    ])('%s → unknown', async (_label, status, body) => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(status, body));

      const error = await captureError(provider.initiateDirectCharge(baseInput));

      expect(error).toBeInstanceOf(DigikuntzDirectChargeError);
      expect(error.kind).toBe('unknown');
    });

    it('erreur réseau (fetch rejeté) → unknown', async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));

      const error = await captureError(provider.initiateDirectCharge(baseInput));

      expect(error.kind).toBe('unknown');
    });

    it('timeout : la requête est annulée par AbortController → unknown', async () => {
      process.env.DIGIKUNTZ_DIRECT_CHARGE_TIMEOUT_MS = '20';
      provider = new DigikuntzProvider();
      fetchSpy.mockImplementationOnce(
        (_url: any, init: any) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );

      const error = await captureError(provider.initiateDirectCharge(baseInput));

      expect(error.kind).toBe('unknown');
    });

    it('2xx avec JSON invalide → unknown', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('pas du json', { status: 201 }));

      const error = await captureError(provider.initiateDirectCharge(baseInput));

      expect(error.kind).toBe('unknown');
    });

    it('2xx sans identifiant de transaction → unknown (impossible de suivre le paiement)', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(201, { status: 'payin_pending', data: {} }));

      const error = await captureError(provider.initiateDirectCharge(baseInput));

      expect(error.kind).toBe('unknown');
    });
  });

  it('sans DIGIKUNTZ_BASE_URL : aucune requête partie → rejected (pas d’issue inconnue)', async () => {
    delete process.env.DIGIKUNTZ_BASE_URL;
    provider = new DigikuntzProvider();

    const error = await captureError(provider.initiateDirectCharge(baseInput));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(error.kind).toBe('rejected');
  });
});
