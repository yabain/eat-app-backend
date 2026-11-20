import { Types } from 'mongoose';
import { DeliveriesService } from './deliveries.service';

describe('DeliveriesService — mes livraisons', () => {
  const driverId = new Types.ObjectId();
  const orderId = new Types.ObjectId();

  let deliveryModel: {
    find: jest.Mock;
    countDocuments: jest.Mock;
    collection: any;
  };
  let service: DeliveriesService;

  beforeEach(() => {
    const query: any = {
      populate: jest.fn(() => query),
      sort: jest.fn(() => query),
      skip: jest.fn(() => query),
      limit: jest.fn().mockResolvedValue([]),
    };
    deliveryModel = {
      find: jest.fn().mockReturnValue(query),
      countDocuments: jest.fn().mockResolvedValue(0),
      collection: { updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }) },
    };

    service = new DeliveriesService(
      deliveryModel as any,
      {} as any, // orderModel
      {} as any, // userModel
      {} as any, // restaurantModel
      {} as any, // deliveryZoneModel
      {} as any, // dispatchSettingsModel
      {} as any, // connection
      {} as any, // paymentsService
      {} as any, // notifications
      {} as any, // cronLease
    );
  });

  it('filtre driverId en ObjectId (livraisons auto-assignées)', async () => {
    await service.my(String(driverId), 1, 10, {
      status: 'assigned,out_for_delivery',
    });

    expect(deliveryModel.find).toHaveBeenCalledWith({
      driverId: new Types.ObjectId(String(driverId)),
      status: { $in: ['assigned', 'out_for_delivery'] },
    });
  });

  it('filtre orderId en ObjectId', async () => {
    await service.my(String(driverId), 1, 10, {
      orderId: String(orderId),
    });

    expect(deliveryModel.find).toHaveBeenCalledWith({
      driverId: new Types.ObjectId(String(driverId)),
      orderId: new Types.ObjectId(String(orderId)),
    });
  });

  it('normalise les anciens driverId/orderId stockés en string au boot', async () => {
    await service.onModuleInit();

    expect(deliveryModel.collection.updateMany).toHaveBeenCalledTimes(2);
    expect(deliveryModel.collection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        driverId: expect.objectContaining({ $type: 'string' }),
      }),
      expect.any(Array),
    );
  });
});