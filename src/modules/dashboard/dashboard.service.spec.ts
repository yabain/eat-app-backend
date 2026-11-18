import { DashboardService } from './dashboard.service';

describe('DashboardService — montant encaissé', () => {
  let orderModel: { aggregate: jest.Mock };
  let service: DashboardService;

  beforeEach(() => {
    orderModel = { aggregate: jest.fn().mockResolvedValue([]) };
    service = new DashboardService(orderModel as any, {} as any, {} as any);
  });

  it('utilise paymentAmount avec repli grandTotal − platformFee (commandes historiques)', () => {
    expect((service as any).paymentAmountExpression()).toEqual({
      $ifNull: [
        '$pricingSnapshot.paymentAmount',
        {
          $subtract: [
            { $ifNull: ['$pricingSnapshot.grandTotal', 0] },
            { $ifNull: ['$pricingSnapshot.platformFee', 0] },
          ],
        },
      ],
    });
  });

  it('applique ce montant encaissé à la série temporelle', () => {
    (service as any).aggregateSeries('day', {});

    const pipeline = orderModel.aggregate.mock.calls[0][0];
    const group = pipeline.find((stage: any) => stage.$group);
    expect(group.$group.revenue.$sum.$cond[1]).toEqual(
      (service as any).paymentAmountExpression(),
    );
  });
});