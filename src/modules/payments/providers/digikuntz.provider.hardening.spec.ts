import { DigikuntzDirectChargeError } from '../errors/direct-charge.errors';
import { DigikuntzProvider } from './digikuntz.provider';

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
