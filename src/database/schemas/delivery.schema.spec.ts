import { DeliverySchema } from './delivery.schema';

describe('DeliverySchema', () => {
  it('type driverId et orderId en ObjectId (pas Mixed)', () => {
    expect(DeliverySchema.path('driverId').instance).toBe('ObjectId');
    expect(DeliverySchema.path('orderId').instance).toBe('ObjectId');
  });
});