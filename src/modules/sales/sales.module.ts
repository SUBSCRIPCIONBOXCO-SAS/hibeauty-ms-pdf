import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { UserSchema } from './schemas/user.model';
import { BrandSchema } from './schemas/brand.model';
import { CategorySchema } from './schemas/category.model';
import { ProductSchema } from './schemas/product.model';
import { PurchaseSchema } from './schemas/purchase.model';
import { PaymentSchema } from './schemas/payment.model';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'User', schema: UserSchema },
      { name: 'Brand', schema: BrandSchema },
      { name: 'Category', schema: CategorySchema },
      { name: 'Product', schema: ProductSchema },
      { name: 'Purchase', schema: PurchaseSchema },
      { name: 'Payment', schema: PaymentSchema },
    ]),
  ],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
