import { Module } from '@nestjs/common';
import { InventoryModule } from './modules/inventory/inventory.module';
import { SalesModule } from './modules/sales/sales.module';
import { DatabaseService } from './core/database.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

@Module({
  imports: [
    InventoryModule, 
    SalesModule, 
    ConfigModule.forRoot(), 
    MongooseModule.forRootAsync({
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: (configService: ConfigService) => ({
      uri: configService.get<string>('MONGODB_URI'),
    }),
  }),
],
  controllers: [],
  providers: [DatabaseService],
})
export class AppModule {}
