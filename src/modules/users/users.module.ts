import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { Delivery, DeliverySchema } from '../../database/schemas/delivery.schema';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [MongooseModule.forFeature([
    { name: User.name, schema: UserSchema },
    { name: Delivery.name, schema: DeliverySchema },
  ])],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
