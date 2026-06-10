import { Injectable, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class DigikuntzProvider {
  private readonly baseUrl = process.env.DIGIKUNTZ_BASE_URL;
  private readonly userId = process.env.DIGIKUNTZ_USER_ID;
  private readonly secretKey = process.env.DIGIKUNTZ_API_KEY;

  private get headers() {
    return {
      'Content-Type': 'application/json',
      'x-user-id': this.userId,
      'x-secret-key': this.secretKey,
    };
  }

  async initiatePayment(orderNumber: string, amount: number, userPhone?: string, userEmail?: string) {
    const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    const callbackUrl = frontendUrl ? `${frontendUrl}/orders` : '';
    const res = await fetch(`${this.baseUrl}/dev/transaction`, {
      method: 'POST',
      headers: this.headers,
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
      throw this.buildProviderError(res, await res.text(), 'DigiKuntz payment');
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
    try {
      const res = await fetch(`${this.baseUrl}/dev/transaction?transactionId=${transactionId}`, {
        method: 'GET',
        headers: this.headers,
      });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  async initiatePayout(input: {
    amount: number;
    phone: string;
    accountBankCode: 'MTN' | 'ORANGEMONEY';
    receiverName: string;
    narration: string;
    callbackUrl?: string;
  }) {
    const res = await fetch(`${this.baseUrl}/dev/payout`, {
      method: 'POST',
      headers: this.headers,
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
    const isHtml = /<\/?[a-z][\s\S]*>/i.test(body);
    const title = body.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.trim();
    const safeDetail = isHtml ? title : body.slice(0, 300);
    const message = res.status >= 500
      ? 'Service de paiement temporairement indisponible. Réessayez dans quelques minutes.'
      : `${context} error${safeDetail ? `: ${safeDetail}` : ''}`;

    if (res.status >= 500) return new ServiceUnavailableException(message);
    return new InternalServerErrorException(message);
  }
}
