import { Injectable, InternalServerErrorException } from '@nestjs/common';

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
    const webhookSecret = process.env.DIGIKUNTZ_WEBHOOK_SECRET;
    const callbackUrl = webhookSecret
      ? `${process.env.APP_URL}/api/payments/webhook/digikuntz?token=${encodeURIComponent(webhookSecret)}`
      : `${process.env.APP_URL}/api/payments/webhook/digikuntz`;
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
        callbackUrl,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new InternalServerErrorException(`DigiKuntz error: ${err}`);
    }

    const data = await res.json();
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
}
