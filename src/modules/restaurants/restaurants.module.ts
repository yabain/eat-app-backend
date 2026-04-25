import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Restaurant, RestaurantSchema } from '../../database/schemas/restaurant.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { RestaurantsController } from './restaurants.controller';
import { RestaurantsService } from './restaurants.service';

@Module({
  imports: [MongooseModule.forFeature([
    { name: Restaurant.name, schema: RestaurantSchema },
    { name: User.name, schema: UserSchema },
  ])],
  providers: [RestaurantsService],
  controllers: [RestaurantsController],
  exports: [RestaurantsService],
})
export class RestaurantsModule {}
