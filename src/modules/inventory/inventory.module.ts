import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { DatabaseService } from 'src/core/database.service';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, DatabaseService],
})
export class InventoryModule {}
