import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Prospect, ProspectSchema } from '../../database/schemas/prospect.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { ProspectsController } from './prospects.controller';
import { ProspectsPublicController } from './prospects-public.controller';
import { ProspectsService } from './prospects.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Prospect.name, schema: ProspectSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ProspectsController, ProspectsPublicController],
  providers: [ProspectsService],
  exports: [ProspectsService],
})
export class ProspectsModule {}
