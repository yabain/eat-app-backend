import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

@Injectable()
export class DigikuntzProvider {
  async initiatePayment(orderNumber: string, amount: number, phone?: string) {
    return {
      providerRef: `DK-${randomUUID().slice(0, 12)}`,
      paymentUrl: `https://checkout.example.local/pay/${orderNumber}`,
      amount,
      phone,
      status: 'pending',
    };
  }
}
