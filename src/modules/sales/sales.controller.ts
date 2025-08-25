import { Controller, Get, Query, Res, Req } from '@nestjs/common';
import express from 'express';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get()
  async salesReport(@Res() res: express.Response, @Req() req: express.Request, @Query('dateInit') dateInit: string, @Query('dateEnd') dateEnd: string) {
    return this.salesService.salesReport(res, req, dateInit, dateEnd);
  }

  @Get('excel')
  async salesReportExcel(@Res() res: express.Response, @Req() req: express.Request, @Query('dateInit') dateInit: string, @Query('dateEnd') dateEnd: string) {
    return this.salesService.salesReportExcel(res, req, dateInit, dateEnd);
  }
}
