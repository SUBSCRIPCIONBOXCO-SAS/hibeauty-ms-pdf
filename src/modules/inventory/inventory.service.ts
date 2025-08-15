import { Injectable, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { DatabaseService } from 'src/core/database.service';
import { Collection } from 'mongodb';
import * as puppeteer from 'puppeteer';

interface Product {
  _id?: any;
  name: string;
  brand?: {
    name: string;
  };
  stock: number;
  costProduct: number;
  price: number;
  visibility: boolean;
}

@Injectable()
export class InventoryService {
  constructor(private readonly databaseService: DatabaseService) {}

  async inventoryReport(res: Response): Promise<void> {
    try {
      // Obtener todos los productos con información completa usando aggregation
      const productsCollection: Collection = this.databaseService.getCollection('products');

      const products = await productsCollection.aggregate([
        // Filtrar productos (equivalente al .find())
        {
          $match: {
            visibility: true,
            removed: false,
            stock: { $gt: 0 }
          }
        },
        // Hacer el "populate" de brand (equivalente al .populate())
        {
          $lookup: {
            from: 'brands',           // Nombre de la colección de brands
            localField: 'brand',      // Campo en products que referencia al brand
            foreignField: '_id',      // Campo _id en la colección brands
            as: 'brandInfo'          // Nombre del campo resultado temporal
          }
        },
        // Procesar el resultado del lookup
        {
          $addFields: {
            brand: {
              $cond: {
                if: { $gt: [{ $size: '$brandInfo' }, 0] },
                then: {
                  name: { $arrayElemAt: ['$brandInfo.name', 0] }
                },
                else: null
              }
            }
          }
        },
        // Proyectar solo los campos necesarios (equivalente al .select())
        {
          $project: {
            _id: 1,
            name: 1,
            brand: 1,
            stock: 1,
            costProduct: 1,
            price: 1,
            visibility: 1
          }
        }
      ]).toArray() as Product[]; // Type assertion to fix the type issue

      if (!products || products.length === 0) {
        throw new NotFoundException('No products found for inventory report');
      }

      // Generar el PDF del reporte
      const pdfBuffer = await this.generateInventoryPDF(products);

      // Configurar headers para descarga del PDF
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="reporte-inventario.pdf"'
      );
      res.setHeader('Content-Length', pdfBuffer.length);

      // Enviar el buffer directamente
      res.end(pdfBuffer);
    } catch (error) {
      throw error;
    }
  }

  // Función auxiliar para generar el PDF
  private async generateInventoryPDF(products: Product[]): Promise<Buffer> {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // Para servidores
    });

    const page = await browser.newPage();

    // Calcular totales
    const totalProducts = products.length;
    const totalStock = products.reduce((sum, item) => sum + (item.stock || 0), 0);
    const totalCostValue = products.reduce(
      (sum, item) => sum + (item.stock || 0) * (item.costProduct || 0),
      0
    );
    const totalPriceValue = products.reduce(
      (sum, item) => sum + (item.stock || 0) * (item.price || 0),
      0
    );

    // Agrupar productos por marca
    const productsByBrand: Record<string, {
      products: Product[];
      totalStock: number;
      totalCostValue: number;
      totalPriceValue: number;
      productCount: number;
    }> = {};

    products.forEach((product) => {
      const brandName = product.brand?.name || 'Sin Marca';

      if (!productsByBrand[brandName]) {
        productsByBrand[brandName] = {
          products: [],
          totalStock: 0,
          totalCostValue: 0,
          totalPriceValue: 0,
          productCount: 0
        };
      }

      const stock = product.stock || 0;
      const costProduct = product.costProduct || 0;
      const price = product.price || 0;

      productsByBrand[brandName].products.push(product);
      productsByBrand[brandName].totalStock += stock;
      productsByBrand[brandName].totalCostValue += stock * costProduct;
      productsByBrand[brandName].totalPriceValue += stock * price;
      productsByBrand[brandName].productCount += 1;
    });

    // Ordenar las marcas alfabéticamente
    const sortedBrands = Object.keys(productsByBrand).sort();

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            margin: 0; 
            padding: 20px;
            font-size: 12px;
          }
          .header { 
            text-align: center; 
            margin-bottom: 30px;
            border-bottom: 2px solid #333;
            padding-bottom: 20px;
          }
          .company-info {
            margin-bottom: 10px;
            color: #666;
          }
          .summary-stats {
            display: flex;
            justify-content: space-around;
            margin: 20px 0;
            padding: 15px;
            background-color: #f8f9fa;
            border-radius: 8px;
          }
          .stat-item {
            text-align: center;
          }
          .stat-value {
            font-size: 18px;
            font-weight: bold;
            color: #2c3e50;
          }
          .stat-label {
            font-size: 11px;
            color: #7f8c8d;
            margin-top: 5px;
          }
          .brand-section {
            margin-bottom: 30px;
            page-break-inside: avoid;
          }
          .brand-header {
            background-color: #2c3e50;
            color: white;
            padding: 12px 15px;
            margin-bottom: 10px;
            border-radius: 5px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .brand-name {
            font-size: 16px;
            font-weight: bold;
          }
          .brand-summary {
            font-size: 12px;
            color: #bdc3c7;
          }
          table { 
            width: 100%; 
            border-collapse: collapse; 
            margin-bottom: 15px;
            font-size: 11px;
          }
          th, td { 
            border: 1px solid #ddd; 
            padding: 8px; 
            text-align: left; 
          }
          th { 
            background-color: #f8f9fa; 
            font-weight: bold;
            font-size: 10px;
            text-transform: uppercase;
          }
          .number { text-align: right; }
          .center { text-align: center; }
          .brand-total-row { 
            background-color: #e8f4f8; 
            font-weight: bold; 
            color: #2c3e50;
          }
          .grand-total-row { 
            background-color: #d4edda; 
            font-weight: bold; 
            color: #155724;
          }
          .footer { 
            margin-top: 30px; 
            font-size: 10px; 
            color: #666;
            text-align: center;
            border-top: 1px solid #ddd;
            padding-top: 15px;
          }
          .low-stock {
            background-color: #fff3cd;
          }
          .out-of-stock {
            background-color: #f8d7da;
          }
          .brand-summary-table {
            margin: 30px 0;
            background-color: #f8f9fa;
            border-radius: 8px;
            padding: 20px;
          }
          .page-break {
            page-break-before: always;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>REPORTE DE INVENTARIO TIENDA EN LINEA</h1>
          <div class="company-info">
            <p><strong>Fecha de Generación:</strong> ${new Date().toLocaleDateString(
              'es-CO',
              {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              }
            )}</p>
          </div>
          <div class="summary-stats">
            <div class="stat-item">
              <div class="stat-value">${totalProducts}</div>
              <div class="stat-label">Total Productos</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">${sortedBrands.length}</div>
              <div class="stat-label">Marcas</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">${totalStock.toLocaleString('es-CO')}</div>
              <div class="stat-label">Unidades en Stock</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">${totalCostValue.toLocaleString('es-CO')}</div>
              <div class="stat-label">Valor Total Costo</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">${totalPriceValue.toLocaleString('es-CO')}</div>
              <div class="stat-label">Valor Total Precio</div>
            </div>
          </div>
        </div>
        
        <!-- Resumen por marcas -->
        <div class="brand-summary-table">
          <h2>Resumen por Marcas</h2>
          <table>
            <thead>
              <tr>
                <th>Marca</th>
                <th class="number">Productos</th>
                <th class="number">Stock Total</th>
                <th class="number">Valor Costo</th>
                <th class="number">Valor Precio</th>
                <th class="number">Utilidad Potencial</th>
              </tr>
            </thead>
            <tbody>
              ${sortedBrands
                .map((brandName) => {
                  const brandData = productsByBrand[brandName];
                  const potentialProfit =
                    brandData.totalPriceValue - brandData.totalCostValue;
                  return `
                  <tr>
                    <td><strong>${brandName}</strong></td>
                    <td class="number">${brandData.productCount}</td>
                    <td class="number">${brandData.totalStock.toLocaleString('es-CO')}</td>
                    <td class="number">${brandData.totalCostValue.toLocaleString('es-CO')}</td>
                    <td class="number">${brandData.totalPriceValue.toLocaleString('es-CO')}</td>
                    <td class="number">${potentialProfit.toLocaleString('es-CO')}</td>
                  </tr>
                `;
                })
                .join('')}
              <tr class="grand-total-row">
                <td><strong>TOTAL GENERAL</strong></td>
                <td class="number"><strong>${totalProducts}</strong></td>
                <td class="number"><strong>${totalStock.toLocaleString('es-CO')}</strong></td>
                <td class="number"><strong>${totalCostValue.toLocaleString('es-CO')}</strong></td>
                <td class="number"><strong>${totalPriceValue.toLocaleString('es-CO')}</strong></td>
                <td class="number"><strong>${(totalPriceValue - totalCostValue).toLocaleString('es-CO')}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="page-break"></div>
        
        <h2>Detalle de Productos por Marca</h2>
        
        ${sortedBrands
          .map((brandName, brandIndex) => {
            const brandData = productsByBrand[brandName];

            return `
          <div class="brand-section">
            <div class="brand-header">
              <div class="brand-name">${brandName}</div>
              <div class="brand-summary">
                ${brandData.productCount} producto${brandData.productCount !== 1 ? 's' : ''} | 
                ${brandData.totalStock.toLocaleString('es-CO')} unidades | 
                Valor: ${brandData.totalPriceValue.toLocaleString('es-CO')}
              </div>
            </div>
            
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th class="number">Cantidad</th>
                  <th class="number">Costo Unit.</th>
                  <th class="number">Precio Unit.</th>
                  <th class="number">Total Costo</th>
                  <th class="number">Total Precio</th>
                  <th class="number">Utilidad</th>
                </tr>
              </thead>
              <tbody>
                ${brandData.products
                  .map((product) => {
                    const stock = product.stock || 0;
                    const costProduct = product.costProduct || 0;
                    const price = product.price || 0;
                    const totalCost = stock * costProduct;
                    const totalPrice = stock * price;
                    const profit = totalPrice - totalCost;

                    let statusClass = '';
                    if (stock === 0) {
                      statusClass = 'out-of-stock';
                    } else if (stock < 10) {
                      statusClass = 'low-stock';
                    }

                    return `
                    <tr class="${statusClass}">
                      <td>${product.name}</td>
                      <td class="number">${stock.toLocaleString('es-CO')}</td>
                      <td class="number">${costProduct.toLocaleString('es-CO')}</td>
                      <td class="number">${price.toLocaleString('es-CO')}</td>
                      <td class="number">${totalCost.toLocaleString('es-CO')}</td>
                      <td class="number">${totalPrice.toLocaleString('es-CO')}</td>
                      <td class="number">${profit.toLocaleString('es-CO')}</td>
                    </tr>
                  `;
                  })
                  .join('')}
                <tr class="brand-total-row">
                  <td><strong>Subtotal ${brandName}</strong></td>
                  <td class="number"><strong>${brandData.totalStock.toLocaleString('es-CO')}</strong></td>
                  <td class="number">-</td>
                  <td class="number">-</td>
                  <td class="number"><strong>${brandData.totalCostValue.toLocaleString('es-CO')}</strong></td>
                  <td class="number"><strong>${brandData.totalPriceValue.toLocaleString('es-CO')}</strong></td>
                  <td class="number"><strong>${(brandData.totalPriceValue - brandData.totalCostValue).toLocaleString('es-CO')}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
          ${brandIndex < sortedBrands.length - 1 ? '<div style="margin-bottom: 20px;"></div>' : ''}
        `;
          })
          .join('')}
        
        <div class="footer">
          <p><strong>Reporte generado automáticamente por el sistema</strong></p>
          <p>Este reporte incluye solo productos visibles, no eliminados y con stock mayor a 0</p>
          <p><strong>Nota:</strong> Los productos están agrupados por marca y ordenados alfabéticamente</p>
        </div>
      </body>
      </html>
    `;

    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfUint8Array = await page.pdf({
      format: 'A4',
      margin: {
        top: '20px',
        right: '15px',
        bottom: '20px',
        left: '15px'
      },
      printBackground: true
    });

    await browser.close();
    
    // Convert Uint8Array to Buffer
    return Buffer.from(pdfUint8Array);
  }
}