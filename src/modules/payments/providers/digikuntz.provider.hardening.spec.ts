import { DigikuntzDirectChargeError } from '../errors/direct-charge.errors';
import {
  DigikuntzIdempotencyInProgressError,
  DigikuntzProvider,
} from './digikuntz.provider';

const BASE_URL = 'https://digikuntz.test/dev';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** fetch qui ne répond jamais et se rejette à l'annulation (simule un timeout réseau). */
function hangingFetch(_url: any, init: any) {
  return new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
}

describe('DigikuntzProvider — durcissement', () => {
  const originalEnv = { ...process.env };
  let fetchSpy: jest.SpyInstance;

  function buildProvider(timeoutMs = '12000') {
    process.env.DIGIKUNTZ_BASE_URL = BASE_URL;
    process.env.DIGIKUNTZ_USER_ID = 'user-id';
    process.env.DIGIKUNTZ_API_KEY = 'secret-key';
    process.env.DIGIKUNTZ_REQUEST_TIMEOUT_MS = timeoutMs;
    return new DigikuntzProvider();
  }

  beforeEach(() => {
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

  describe('item 3 — lecture du statut avec timeout', () => {
    it('getTransactionStatus (cron, webhook) : timeout → null, jamais d’exception', async () => {
      const provider = buildProvider('20');
      fetchSpy.mockImplementationOnce(hangingFetch as any);

      await expect(provider.getTransactionStatus('PROV-1')).resolves.toBeNull();
    });

    it('getTransactionStatusOrThrow (chemin client) : timeout → unknown', async () => {
      const provider = buildProvider('20');
      fetchSpy.mockImplementationOnce(hangingFetch as any);

      const error = await captureError(provider.getTransactionStatusOrThrow('PROV-1'));

      expect(error).toBeInstanceOf(DigikuntzDirectChargeError);
      expect(error.kind).toBe('unknown');
    });

    it('getTransactionStatusOrThrow : réseau en échec → unknown', async () => {
      const provider = buildProvider();
      fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));

      const error = await captureError(provider.getTransactionStatusOrThrow('PROV-1'));

      expect(error.kind).toBe('unknown');
    });

    it('getTransactionStatusOrThrow : réponse non OK → unknown', async () => {
      const provider = buildProvider();
      fetchSpy.mockResolvedValueOnce(jsonResponse(500, { status: 'error' }));

      const error = await captureError(provider.getTransactionStatusOrThrow('PROV-1'));

      expect(error.kind).toBe('unknown');
    });

    it('getTransactionStatusOrThrow : corps sans statut → unknown', async () => {
      const provider = buildProvider();
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, 'Unauthorized'));

      const error = await captureError(provider.getTransactionStatusOrThrow('PROV-1'));

      expect(error.kind).toBe('unknown');
    });

    it('getTransactionStatusOrThrow : succès → renvoie le statut distant', async () => {
      const provider = buildProvider();
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { id: 'PROV-1', status: 'payin_pending', data: {} }));

      const remote = await provider.getTransactionStatusOrThrow('PROV-1');

      expect(remote.status).toBe('payin_pending');
    });
  });

  describe('item 8 — hébergé : pas de corps brut dans le message', () => {
    it('initiatePayment 4xx : message générique français, aucun corps brut', async () => {
      const provider = buildProvider();
      fetchSpy.mockResolvedValueOnce(new Response('<html><title>SECRET-BODY</title></html>', { status: 400 }));

      const error = await captureError(
        provider.initiatePayment('ORD-1', 4200, '655000000', 'client@example.com'),
      );

      expect(error.message).not.toMatch(/SECRET-BODY|<html|DigiKuntz payment error/i);
      expect(error.message).toMatch(/paiement/i);
    });

    it('initiatePayment 5xx : indisponibilité (ServiceUnavailable) inchangée', async () => {
      const provider = buildProvider();
      fetchSpy.mockResolvedValueOnce(new Response('boom', { status: 502 }));

      const error = await captureError(provider.initiatePayment('ORD-1', 4200));

      expect(error.getStatus()).toBe(503);
    });
  });

  describe('idempotence — en-tête Idempotency-Key', () => {
    it('direct charge : la clé part en header, jamais dans le body', async () => {
      const provider = buildProvider();
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(201, {
          id: 'P-1',
          status: 'payin_pending',
          data: { chargeStatus: 'success' },
        }),
      );

      await provider.initiateDirectCharge({
        estimation: 100,
        userPhone: '237650123456',
        senderName: 'Jean',
        paymentMethodCode: 'MTN',
        idempotencyKey: 'direct-1',
      });

      const init = fetchSpy.mock.calls[0][1];
      expect(init.headers['Idempotency-Key']).toBe('direct-1');
      expect(JSON.parse(String(init.body)).idempotencyKey).toBeUndefined();
    });

    it('paiement hébergé : la clé part en header', async () => {
      const provider = buildProvider();
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(201, {
          id: 'P-2',
          status: 'payin_pending',
          data: { paymentLink: 'https://checkout.flutterwave.com/x' },
        }),
      );

      await provider.initiatePayment('ORD-1', 100, '237650123456', 'e@x.cm', {
        idempotencyKey: 'payin-1',
      });

      const init = fetchSpy.mock.calls[0][1];
      expect(init.headers['Idempotency-Key']).toBe('payin-1');
    });

    it('payout : la clé part en header', async () => {
      const provider = buildProvider();
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(201, {
          id: 'P-3',
          status: 'payout_pending',
          data: { transactionRef: 'TX-1' },
        }),
      );

      await provider.initiatePayout({
        amount: 1000,
        phone: '237650123456',
        accountBankCode: 'MTN',
        receiverName: 'Jean',
        narration: 'Retrait',
        idempotencyKey: 'withdrawal-1',
      });

      const init = fetchSpy.mock.calls[0][1];
      expect(init.headers['Idempotency-Key']).toBe('withdrawal-1');
    });
  });

  describe('payouts — état via la route documentée /dev/api-payouts', () => {
    it('retrouve un payout par transactionRef et normalise transaction_payout_pending', async () => {
      const provider = buildProvider();
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(200, {
          data: [
            {
              _id: 'P-1',
              status: 'transaction_payout_pending',
              transactionRef: 'TX-1',
            },
          ],
        }),
      );

      const payout = await provider.getPayoutStatus({ transactionRef: 'TX-1' });

      expect(payout).toEqual(
        expect.objectContaining({ id: 'P-1', status: 'payout_pending' }),
      );
    });

    it('renvoie null si le payout n’est pas dans la page', async () => {
      const provider = buildProvider();
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, { data: [] }));

      await expect(provider.getPayoutStatus({ providerRef: 'P-404' })).resolves.toBeNull();
    });
  });

  describe('item 8 — retraits : contrat du message d’erreur conservé', () => {
    it('initiatePayout 4xx : le détail fournisseur reste lisible par le parseur des retraits', async () => {
      const provider = buildProvider();
      fetchSpy.mockResolvedValueOnce(jsonResponse(409, { statusCode: 409, message: 'Insufficient balance' }));

      const error = await captureError(
        provider.initiatePayout({
          amount: 1000,
          phone: '237650123456',
          accountBankCode: 'MTN',
          receiverName: 'Jean',
          narration: 'Retrait',
        }),
      );

      expect(error.message.startsWith('DigiKuntz payout error: ')).toBe(true);
      expect(error.message).toContain('Insufficient balance');
    });

    it('initiatePayout 409 d’idempotence : classe « en cours », jamais un refus', async () => {
      const provider = buildProvider();
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(409, {
          statusCode: 409,
          message: 'Request with this Idempotency-Key is still in progress',
        }),
      );

      const error = await captureError(
        provider.initiatePayout({
          amount: 1000,
          phone: '237650123456',
          accountBankCode: 'MTN',
          receiverName: 'Jean',
          narration: 'Retrait',
        }),
      );

      expect(error).toBeInstanceOf(DigikuntzIdempotencyInProgressError);
      expect(error.getStatus()).toBe(503);
    });

    it('initiatePayout 409 sans corps : ambigu, jamais un refus', async () => {
      const provider = buildProvider();
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 409 }));

      const error = await captureError(
        provider.initiatePayout({
          amount: 1000,
          phone: '237650123456',
          accountBankCode: 'MTN',
          receiverName: 'Jean',
          narration: 'Retrait',
        }),
      );

      expect(error).toBeInstanceOf(DigikuntzIdempotencyInProgressError);
    });
  });

  describe('idempotence payin hébergé', () => {
    it('initiatePayment 409 d’idempotence : issue inconnue, pas un échec définitif', async () => {
      const provider = buildProvider();
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(409, {
          statusCode: 409,
          message: 'Request with this Idempotency-Key is still in progress',
        }),
      );

      const error = await captureError(
        provider.initiatePayment('ORD-1', 4200, '655000000', 'client@example.com'),
      );

      expect(error).toBeInstanceOf(DigikuntzIdempotencyInProgressError);
      expect(error.getStatus()).toBe(503);
    });
  });

  describe('item 12 — refusalReason contrôlé', () => {
    it('ne retient que les codes en majuscules (pas de texte libre fournisseur)', async () => {
      const provider = buildProvider();
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(201, {
          id: 'PROV-9',
          status: 'payin_pending',
          data: { chargeStatus: 'failed', fallback: { reason: '<script>x</script>' }, paymentLink: 'https://checkout.flutterwave.com/x' },
        }),
      );

      const result = await provider.initiateDirectCharge({
        estimation: 4200,
        userPhone: '237650123456',
        senderName: 'Jean',
        paymentMethodCode: 'MTN',
      });

      expect(result.refused).toBe(true);
      expect(result.refusalReason).toBeUndefined();
      expect(result).not.toHaveProperty('status');
    });
  });
});
