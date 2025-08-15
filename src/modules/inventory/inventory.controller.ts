import { Controller, Get, Res } from '@nestjs/common';
import express from 'express';
import { InventoryService } from './inventory.service';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  async inventoryReport(@Res() res: express.Response) {
    return this.inventoryService.inventoryReport(res);
  }
}
