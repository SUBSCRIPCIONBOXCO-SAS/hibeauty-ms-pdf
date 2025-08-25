import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Response, Request } from 'express';
import * as puppeteer from 'puppeteer';
import * as moment from 'moment-timezone';
import { User } from './schemas/user.model';
import { Brand } from './schemas/brand.model';
import { Category } from './schemas/category.model';
import { Product } from './schemas/product.model';
import { Purchase } from './schemas/purchase.model';
import { Payment } from './schemas/payment.model';
import * as XLSX from 'xlsx';

@Injectable()
export class SalesService {
  constructor(
    @InjectModel('User') private readonly userModel: Model<User>,
    @InjectModel('Brand') private readonly brandModel: Model<Brand>,
    @InjectModel('Category') private readonly categoryModel: Model<Category>,
    @InjectModel('Product') private readonly productModel: Model<Product>,
    @InjectModel('Purchase') private readonly purchaseModel: Model<Purchase>,
    @InjectModel('Payment') private readonly paymentModel: Model<Payment>,
  ) {}

  async salesReport(
    res: Response,
    req: Request,
    dateInit: string,
    dateEnd: string,
  ) {
    try {
      if (!dateInit || !dateEnd) {
        return res.status(400).json({
          success: false,
          info: 'Debes enviar dateInit y dateEnd en el query',
        });
      }

      // 1. Ajustar fechas a hora Colombia y convertir a UTC
      const start = moment
        .tz(dateInit, 'YYYY-MM-DD', 'America/Bogota')
        .startOf('day')
        .utc()
        .toDate();
      const end = moment
        .tz(dateEnd, 'YYYY-MM-DD', 'America/Bogota')
        .endOf('day')
        .utc()
        .toDate();

      // 2. Obtener compras con filtros
      const purchases = await this.purchaseModel
        .find({
          status: { $in: ['Aprobada', 'Despachada', 'Entregada'] },
          createdAt: { $gte: start, $lte: end },
          products: { $exists: true, $ne: null },
          $expr: { $gt: [{ $size: '$products' }, 0] },
          paymentMethod: { $nin: ['referred', '', null] },
        })
        .populate({
          path: 'products.id',
          model: 'Product',
          select:
            '_id name price discount brand category ref tone color costProduct',
          populate: [
            { path: 'brand', model: 'Brand', select: '_id name' },
            { path: 'category', model: 'Category', select: '_id name' },
            {
              path: 'ref',
              model: 'Product',
              select:
                '_id name price discount brand category tone color costProduct',
              populate: [
                { path: 'brand', model: 'Brand', select: '_id name' },
                { path: 'category', model: 'Category', select: '_id name' },
              ],
            },
          ],
        })
        .lean();

      // 2.1 Obtener pagos manuales con filtros
      const payments = await this.paymentModel
        .find({
          status: 'approved',
          createdAt: { $gte: start, $lte: end },
          isStore: true,
          store: { $exists: true, $ne: null },
          $expr: { $gt: [{ $size: '$store' }, 0] },
        })
        .populate({
          path: 'store.id',
          model: 'Product',
          select:
            '_id name price discount brand category ref tone color costProduct',
          populate: [
            { path: 'brand', model: 'Brand', select: '_id name' },
            { path: 'category', model: 'Category', select: '_id name' },
            {
              path: 'ref',
              model: 'Product',
              select:
                '_id name price discount brand category tone color costProduct',
              populate: [
                { path: 'brand', model: 'Brand', select: '_id name' },
                { path: 'category', model: 'Category', select: '_id name' },
              ],
            },
          ],
        })
        .populate({
          path: 'lastAdminEdit',
          model: 'User',
          select: '_id fullName email',
        })
        .lean();

      // 3. Array para el reporte detallado
      const ventasDetalladas: any[] = [];

      // 4. Procesar cada compra
      purchases.forEach((purchase: any) => {
        let totalCompra = 0;

        // ✅ REPLICAR LÓGICA EXACTA DE LA FUNCIÓN ORIGINAL
        // Usar purchase.total si es válido, sino calcular por productos
        if (purchase.total && purchase.total > 0) {
          totalCompra = Number(purchase.total);

          // Calcular suma con precios de productos (puede tener descuentos individuales)
          const sumaConDescuentosIndividuales = purchase.products.reduce(
            (sum, prod) => {
              const product = prod.id;
              if (!product) return sum;
              const main = product.ref || product;
              const precioReal = Number(main.price) || 0;
              const descuentoProductoRaw =
                (product?.ref?.discount != null
                  ? Number(product.ref.discount)
                  : product?.discount != null
                    ? Number(product.discount)
                    : 0) || 0;
              const factorDescuentoProducto =
                descuentoProductoRaw > 0
                  ? descuentoProductoRaw <= 1
                    ? descuentoProductoRaw
                    : descuentoProductoRaw <= 100
                      ? descuentoProductoRaw / 100
                      : 1
                  : 0;
              const precioDerivadoPorDescuento = Math.round(
                precioReal * (1 - factorDescuentoProducto),
              );
              const priceLinea =
                Number(prod.price) > 0 ? Number(prod.price) : null;
              const precioProducto =
                factorDescuentoProducto > 0
                  ? priceLinea === null
                    ? precioDerivadoPorDescuento
                    : Math.min(priceLinea, precioDerivadoPorDescuento)
                  : priceLinea === null
                    ? precioReal
                    : priceLinea;
              const cantidad = Number(prod.quantity) || 0;
              return sum + precioProducto * cantidad;
            },
            0,
          );

          // Determinar si hay descuento a nivel de compra
          const hayDescuentoCompra =
            totalCompra > 0 &&
            sumaConDescuentosIndividuales > 0 &&
            totalCompra < sumaConDescuentosIndividuales;
          const factorDescuentoCompra = hayDescuentoCompra
            ? totalCompra / sumaConDescuentosIndividuales
            : 1;

          // Procesar productos para el detalle aplicando factor si corresponde
          const lineasCompra: any[] = [];
          let sumaLineasRedondeadas = 0;
          purchase.products.forEach((prod) => {
            const product = prod.id;
            if (!product) return;
            const main = product.ref || product;
            const precioReal = Number(main.price) || 0;
            const cantidad = Number(prod.quantity) || 0;

            // ✅ OBTENER COSTO DEL PRODUCTO
            const costoProducto = Number(main.costProduct) || 0;

            // Precio con descuento individual (si existe en la línea) o derivado del discount del producto
            const descuentoProductoRaw = Number(main.discount) || 0;
            const factorDescuentoProducto =
              descuentoProductoRaw > 0
                ? descuentoProductoRaw <= 1
                  ? descuentoProductoRaw
                  : descuentoProductoRaw <= 100
                    ? descuentoProductoRaw / 100
                    : 1
                : 0;
            const precioDerivadoPorDescuento = Math.round(
              precioReal * (1 - factorDescuentoProducto),
            );
            const priceLinea =
              Number(prod.price) > 0 ? Number(prod.price) : null;
            let precioConDescuentoIndividual =
              priceLinea === null ? precioDerivadoPorDescuento : priceLinea;
            if (factorDescuentoProducto > 0) {
              // Prefiere el precio con descuento de producto si es menor que el de línea o si la línea no trae descuento
              const preferido = precioDerivadoPorDescuento;
              if (priceLinea === null || preferido < priceLinea) {
                precioConDescuentoIndividual = preferido;
              }
            }

            // Precio final considerando ambos tipos de descuento
            let precioFinalVendido = precioConDescuentoIndividual;
            let tipoDescuento = 'Sin descuento';
            let porcentajeDescuento = 0;
            const hayDescuentoIndividual =
              precioConDescuentoIndividual < precioReal;

            if (hayDescuentoCompra) {
              // Aplicar descuento a nivel de compra
              precioFinalVendido =
                precioConDescuentoIndividual * factorDescuentoCompra;
              tipoDescuento = hayDescuentoIndividual
                ? 'Ambos'
                : 'Descuento en compra';
              // porcentaje efectivo total vs precioReal
              porcentajeDescuento = (1 - precioFinalVendido / precioReal) * 100;
            } else if (hayDescuentoIndividual) {
              // Solo descuento individual
              tipoDescuento = 'Descuento individual';
              porcentajeDescuento =
                ((precioReal - precioConDescuentoIndividual) / precioReal) *
                100;
            }

            const totalProd = precioFinalVendido * cantidad;
            const totalProdRedondeado = Math.round(totalProd);
            const precioVendidoRedondeado = Math.round(precioFinalVendido);

            // ✅ CALCULAR GANANCIA POR UNIDAD Y TOTAL
            const gananciaPorUnidad = precioVendidoRedondeado - costoProducto;
            const gananciaTotal = gananciaPorUnidad * cantidad;
            const margenGanancia =
              costoProducto > 0 ? (gananciaPorUnidad / costoProducto) * 100 : 0;

            // Preparar línea (se insertará luego de reconciliar)
            const linea: any = {
              nombreProducto: main.name?.trim() || 'Producto sin nombre',
              marca: main.brand?.name?.trim() || 'Sin marca',
              cantidadVendida: cantidad,
              precioReal,
              precioVendido: precioVendidoRedondeado,
              totalVenta: totalProdRedondeado,
              costoProducto, // ✅ NUEVO CAMPO
              gananciaPorUnidad, // ✅ NUEVO CAMPO
              gananciaTotal, // ✅ NUEVO CAMPO
              margenGanancia: Math.round(margenGanancia * 100) / 100, // ✅ NUEVO CAMPO
              tono: (
                product.color?.name ||
                product.tone?.name ||
                'Sin tono'
              ).trim(),
              categoria: main.category?.name?.trim() || 'Sin categoría',
              tipoTransaccion: 'Compra',
              fechaVenta: purchase.createdAt,
              idTransaccion: purchase._id,
              usuario: purchase.user?.fullName || '',
              tipoDescuento,
              porcentajeDescuento: Math.round(porcentajeDescuento * 100) / 100,
              precioConDescuentoIndividual,
              hayDescuentoCompra,
              factorDescuentoCompra:
                Math.round(factorDescuentoCompra * 10000) / 10000,
            };
            if (req.query.debug === 'true') {
              const priceLinea =
                Number(prod.price) > 0 ? Number(prod.price) : null;
              const descuentoProducto = Number(main.discount) || 0;
              const precioDerivadoPorDescuento = Math.round(
                precioReal *
                  (1 - (descuentoProducto > 0 ? descuentoProducto : 0) / 100),
              );
              const precioBaseElegido = precioConDescuentoIndividual;
              const fuenteDescuentoIndividual =
                descuentoProducto > 0 &&
                (priceLinea === null || precioDerivadoPorDescuento < priceLinea)
                  ? 'producto'
                  : priceLinea !== null && priceLinea < precioReal
                    ? 'linea'
                    : null;
              linea.audit = {
                precioLinea: priceLinea,
                descuentoProducto,
                precioDerivadoPorDescuento,
                precioBaseElegido,
                fuenteDescuentoIndividual,
                factorAplicado: hayDescuentoCompra ? factorDescuentoCompra : 1,
              };
            }
            lineasCompra.push(linea);
            sumaLineasRedondeadas += totalProdRedondeado;
          });

          // Reconciliar para que la suma de líneas coincida con purchase.total
          const objetivo = totalCompra; // purchase.total ya numérico
          const diferencia =
            Math.round(objetivo) - Math.round(sumaLineasRedondeadas);
          if (lineasCompra.length > 0 && diferencia !== 0) {
            const idx = lineasCompra.length - 1; // ajustar última línea
            const lineaAjuste = lineasCompra[idx];
            const nuevoTotal = Math.max(0, lineaAjuste.totalVenta + diferencia);
            const qty = Number(lineaAjuste.cantidadVendida) || 1;
            const nuevoPrecioVendido = Math.round(nuevoTotal / qty);

            // ✅ RECALCULAR GANANCIA DESPUÉS DEL AJUSTE
            const nuevaGananciaPorUnidad =
              nuevoPrecioVendido - lineaAjuste.costoProducto;
            const nuevaGananciaTotal = nuevaGananciaPorUnidad * qty;
            const nuevoMargenGanancia =
              lineaAjuste.costoProducto > 0
                ? (nuevaGananciaPorUnidad / lineaAjuste.costoProducto) * 100
                : 0;

            lineaAjuste.totalVenta = nuevoTotal;
            lineaAjuste.precioVendido = nuevoPrecioVendido;
            lineaAjuste.gananciaPorUnidad = nuevaGananciaPorUnidad;
            lineaAjuste.gananciaTotal = nuevaGananciaTotal;
            lineaAjuste.margenGanancia =
              Math.round(nuevoMargenGanancia * 100) / 100;

            lineasCompra[idx] = lineaAjuste;
          }

          // Insertar líneas reconciliadas
          ventasDetalladas.push(...lineasCompra);
        } else {
          // Calcular por productos cuando no hay purchase.total válido
          // Alineado con agregaciones: usar exactamente sum(price * quantity) sin descuentos derivados
          const lineasCompraSinTotal: any[] = [];
          purchase.products.forEach((prod: any) => {
            const product = prod.id;
            if (!product) return;
            const main = product.ref || product;
            const precioReal = Number(main.price) || 0;
            const costoProducto = Number(main.costProduct) || 0; // ✅ NUEVO CAMPO
            const priceLinea =
              Number(prod.price) > 0 ? Number(prod.price) : null;
            const precioVendido = priceLinea === null ? precioReal : priceLinea; // sin descuentos derivados
            const cantidad = Number(prod.quantity) || 0;
            const totalProd = precioVendido * cantidad;
            totalCompra += totalProd;

            // ✅ CALCULAR GANANCIA
            const gananciaPorUnidad = precioVendido - costoProducto;
            const gananciaTotal = gananciaPorUnidad * cantidad;
            const margenGanancia =
              costoProducto > 0 ? (gananciaPorUnidad / costoProducto) * 100 : 0;

            // Preparar línea (se insertará luego de reconciliar)
            const totalProdRedondeado = Math.round(totalProd);
            const precioVendidoRedondeado = Math.round(precioVendido);
            const linea2: any = {
              nombreProducto: main.name?.trim() || 'Producto sin nombre',
              marca: main.brand?.name?.trim() || 'Sin marca',
              cantidadVendida: cantidad,
              precioReal,
              precioVendido: precioVendidoRedondeado,
              totalVenta: totalProdRedondeado,
              costoProducto, // ✅ NUEVO CAMPO
              gananciaPorUnidad: Math.round(gananciaPorUnidad), // ✅ NUEVO CAMPO
              gananciaTotal: Math.round(gananciaTotal), // ✅ NUEVO CAMPO
              margenGanancia: Math.round(margenGanancia * 100) / 100, // ✅ NUEVO CAMPO
              tono: (
                product.color?.name ||
                product.tone?.name ||
                'Sin tono'
              ).trim(),
              categoria: main.category?.name?.trim() || 'Sin categoría',
              tipoTransaccion: 'Compra',
              fechaVenta: purchase.createdAt,
              idTransaccion: purchase._id,
              usuario: purchase.user?.fullName || '',
              tipoDescuento:
                priceLinea !== null && priceLinea < precioReal
                  ? 'Descuento individual'
                  : 'Sin descuento',
              porcentajeDescuento:
                priceLinea !== null && priceLinea < precioReal
                  ? Math.round(
                      ((precioReal - priceLinea) / precioReal) * 100 * 100,
                    ) / 100
                  : 0,
              precioConDescuentoIndividual:
                priceLinea !== null ? priceLinea : precioReal,
              hayDescuentoCompra: false,
              factorDescuentoCompra: 1,
            };
            if (req.query.debug === 'true') {
              const precioBaseElegido = precioVendido;
              const fuenteDescuentoIndividual =
                priceLinea !== null && priceLinea < precioReal ? 'linea' : null;
              linea2.audit = {
                precioLinea: priceLinea,
                descuentoProducto: Number(main.discount) || 0,
                precioDerivadoPorDescuento: null,
                precioBaseElegido,
                fuenteDescuentoIndividual,
                factorAplicado: 1,
              };
            }
            lineasCompraSinTotal.push(linea2);
          });

          // Reconciliar para que la suma de líneas coincida con subtotal calculado sum(price*quantity)
          const objetivo2 = Math.round(totalCompra);
          const sumaRedondeada2 = lineasCompraSinTotal.reduce(
            (s, l) => s + (Number(l.totalVenta) || 0),
            0,
          );
          if (
            lineasCompraSinTotal.length > 0 &&
            sumaRedondeada2 !== objetivo2
          ) {
            const idx2 = lineasCompraSinTotal.length - 1;
            const lineaAjuste2 = lineasCompraSinTotal[idx2];
            const nuevoTotal2 = Math.max(
              0,
              lineaAjuste2.totalVenta + (objetivo2 - sumaRedondeada2),
            );
            const qty2 = Number(lineaAjuste2.cantidadVendida) || 1;
            const nuevoPrecioVendido2 = Math.round(nuevoTotal2 / qty2);

            // ✅ RECALCULAR GANANCIA DESPUÉS DEL AJUSTE
            const nuevaGananciaPorUnidad2 =
              nuevoPrecioVendido2 - lineaAjuste2.costoProducto;
            const nuevaGananciaTotal2 = nuevaGananciaPorUnidad2 * qty2;
            const nuevoMargenGanancia2 =
              lineaAjuste2.costoProducto > 0
                ? (nuevaGananciaPorUnidad2 / lineaAjuste2.costoProducto) * 100
                : 0;

            lineaAjuste2.totalVenta = nuevoTotal2;
            lineaAjuste2.precioVendido = nuevoPrecioVendido2;
            lineaAjuste2.gananciaPorUnidad = nuevaGananciaPorUnidad2;
            lineaAjuste2.gananciaTotal = nuevaGananciaTotal2;
            lineaAjuste2.margenGanancia =
              Math.round(nuevoMargenGanancia2 * 100) / 100;

            lineasCompraSinTotal[idx2] = lineaAjuste2;
          }
          ventasDetalladas.push(...lineasCompraSinTotal);
        }
      });

      // 4.1 Procesar cada pago manual
      payments.forEach((payment: any) => {
        const totalPayment = Number(payment.total) || 0;

        // Suma de ítems basada en el precio de línea (p.price), como en las agregaciones
        const sumItemsLinea = payment.store.reduce((s, p) => {
          const price = Number(p?.price) > 0 ? Number(p.price) : 0;
          const qty = Number(p?.quantity) || 0;
          return s + price * qty;
        }, 0);

        // Determinar si hay descuento a nivel de pago usando sumItemsLinea
        const hayDescuentoPago =
          totalPayment > 0 && totalPayment < sumItemsLinea;
        const factorDescuentoPago = hayDescuentoPago
          ? totalPayment / sumItemsLinea
          : 1;

        // Procesar productos
        const lineasPago: any[] = [];
        let sumaLineasPago = 0;
        payment.store.forEach((prod: any) => {
          const product = prod.id;
          if (!product) return;
          const main = product.ref || product;
          const precioReal = Number(main.price) || 0;
          const costoProducto = Number(main.costProduct) || 0; // ✅ NUEVO CAMPO
          const cantidad = Number(prod.quantity) || 0;

          // Precio con descuento individual (solo si el precio en la línea es menor al precio real)
          const priceLinea = Number(prod.price) > 0 ? Number(prod.price) : null;
          let precioConDescuentoIndividual = precioReal;

          // Solo aplicar descuento individual si el precio en la línea es menor y mayor a 0
          if (
            priceLinea !== null &&
            priceLinea > 0 &&
            priceLinea < precioReal
          ) {
            precioConDescuentoIndividual = priceLinea;
          }

          // Precio final considerando ambos tipos de descuento
          let precioFinalVendido = precioConDescuentoIndividual;
          let tipoDescuento = 'Sin descuento';
          let porcentajeDescuento = 0;
          const hayDescuentoIndividual =
            precioConDescuentoIndividual < precioReal;

          if (hayDescuentoPago) {
            // Aplicar descuento a nivel de pago
            precioFinalVendido =
              precioConDescuentoIndividual * factorDescuentoPago;
            tipoDescuento = hayDescuentoIndividual
              ? 'Ambos'
              : 'Descuento en pago';
            // porcentaje efectivo total vs precioReal (redondeado a 2 decimales)
            porcentajeDescuento =
              Math.round((1 - precioFinalVendido / precioReal) * 100 * 100) /
              100;
          } else if (hayDescuentoIndividual) {
            // Solo descuento individual
            tipoDescuento = 'Descuento individual';
            porcentajeDescuento =
              Math.round(
                (1 - precioConDescuentoIndividual / precioReal) * 100 * 100,
              ) / 100;
          }

          const totalProd = precioFinalVendido * cantidad;
          const totalProdRedondeado = Math.round(totalProd);
          const precioVendidoFinal = Math.round(precioFinalVendido);

          // ✅ CALCULAR GANANCIA
          const gananciaPorUnidad = precioVendidoFinal - costoProducto;
          const gananciaTotal = gananciaPorUnidad * cantidad;
          const margenGanancia =
            costoProducto > 0 ? (gananciaPorUnidad / costoProducto) * 100 : 0;

          // ✅ AGREGAR AL REPORTE DETALLADO (con auditoría opcional)
          const lineaPago: any = {
            nombreProducto: main.name?.trim() || 'Producto sin nombre',
            marca: main.brand?.name?.trim() || 'Sin marca',
            cantidadVendida: cantidad,
            precioReal,
            precioVendido: precioVendidoFinal,
            totalVenta: totalProdRedondeado,
            costoProducto, // ✅ NUEVO CAMPO
            gananciaPorUnidad, // ✅ NUEVO CAMPO
            gananciaTotal, // ✅ NUEVO CAMPO
            margenGanancia: Math.round(margenGanancia * 100) / 100, // ✅ NUEVO CAMPO
            tono: (
              product.color?.name ||
              product.tone?.name ||
              'Sin tono'
            ).trim(),
            categoria: main.category?.name?.trim() || 'Sin categoría',
            tipoTransaccion: 'Pago Manual',
            fechaVenta: payment.createdAt,
            idTransaccion: payment._id,
            usuario: payment.lastAdminEdit?.fullName || '',
            tipoDescuento,
            porcentajeDescuento: Math.round(porcentajeDescuento * 100) / 100,
            precioConDescuentoIndividual,
            hayDescuentoCompra: hayDescuentoPago,
            factorDescuentoCompra:
              Math.round(factorDescuentoPago * 10000) / 10000,
          };
          if (req.query.debug === 'true') {
            const priceLinea =
              Number(prod.price) > 0 ? Number(prod.price) : null;
            const descuentoProducto = Number(main.discount) || 0;
            const precioDerivadoPorDescuento = Math.round(
              precioReal *
                (1 - (descuentoProducto > 0 ? descuentoProducto : 0) / 100),
            );
            const precioBaseElegido = precioConDescuentoIndividual;
            const fuenteDescuentoIndividual =
              descuentoProducto > 0 &&
              (priceLinea === null || precioDerivadoPorDescuento < priceLinea)
                ? 'producto'
                : priceLinea !== null && priceLinea < precioReal
                  ? 'linea'
                  : null;
            lineaPago.audit = {
              precioLinea: priceLinea,
              descuentoProducto,
              precioDerivadoPorDescuento,
              precioBaseElegido,
              fuenteDescuentoIndividual,
              factorAplicado: hayDescuentoPago ? factorDescuentoPago : 1,
            };
          }
          lineasPago.push(lineaPago);
          sumaLineasPago += totalProdRedondeado;
        });

        // 📊 Objetivo del pago: min(totalPayment válido, sumItemsLinea). Reconciliar líneas a este objetivo
        const objetivoPago = Math.round(
          hayDescuentoPago ? totalPayment : sumItemsLinea,
        );
        const diferenciaPago = objetivoPago - Math.round(sumaLineasPago);
        if (lineasPago.length > 0 && diferenciaPago !== 0) {
          const idx = lineasPago.length - 1;
          const linea = lineasPago[idx];
          const nuevoTotal = Math.max(0, linea.totalVenta + diferenciaPago);
          const qty = Number(linea.cantidadVendida) || 1;
          const nuevoPrecioVendido = Math.round(nuevoTotal / qty);

          // ✅ RECALCULAR GANANCIA DESPUÉS DEL AJUSTE
          const nuevaGananciaPorUnidad =
            nuevoPrecioVendido - linea.costoProducto;
          const nuevaGananciaTotal = nuevaGananciaPorUnidad * qty;
          const nuevoMargenGanancia =
            linea.costoProducto > 0
              ? (nuevaGananciaPorUnidad / linea.costoProducto) * 100
              : 0;

          linea.totalVenta = nuevoTotal;
          linea.precioVendido = nuevoPrecioVendido;
          linea.gananciaPorUnidad = nuevaGananciaPorUnidad;
          linea.gananciaTotal = nuevaGananciaTotal;
          linea.margenGanancia = Math.round(nuevoMargenGanancia * 100) / 100;

          lineasPago[idx] = linea;
        }
        ventasDetalladas.push(...lineasPago);
      });

      // 5. Ordenar por fecha más reciente y calcular totales alineados con las agregaciones de MongoDB
      const ventasOrdenadas = ventasDetalladas.sort(
        (a, b) =>
          new Date(b.fechaVenta).getTime() - new Date(a.fechaVenta).getTime(),
      );

      // Total de compras: usar purchase.total si es > 0; de lo contrario, sumar price*quantity de cada ítem sin descuentos
      const totalComprasAgregado = purchases.reduce((sum, purchase: any) => {
        if (purchase?.total && Number(purchase.total) > 0) {
          return sum + Number(purchase.total);
        }
        const subtotal = (purchase?.products || []).reduce((s, p) => {
          const price = Number(p?.price) > 0 ? Number(p.price) : 0;
          const qty = Number(p?.quantity) || 0;
          return s + price * qty;
        }, 0);
        return sum + subtotal;
      }, 0);

      // Total de pagos manuales: sumItems = sum(price*quantity); total efectivo = (total>0 && total<sumItems) ? total : sumItems
      const totalPagosAgregado = payments.reduce((sum, payment) => {
        const sumItems = (payment?.store || []).reduce((s, p) => {
          const price = Number(p?.price) > 0 ? Number(p.price) : 0;
          const qty = Number(p?.quantity) || 0;
          return s + price * qty;
        }, 0);
        const totalPay = Number(payment?.total) || 0;
        const efectivo =
          totalPay > 0 && totalPay < sumItems ? totalPay : sumItems;
        return sum + efectivo;
      }, 0);

      // Este es el total que debe coincidir con las agregaciones compartidas
      const totalFacturadoDetallado = totalComprasAgregado + totalPagosAgregado;

      // ✅ CALCULAR TOTALES DE GANANCIA
      const totalGanancia = ventasDetalladas.reduce((sum, venta) => {
        return sum + (Number(venta.gananciaTotal) || 0);
      }, 0);

      const totalCosto = ventasDetalladas.reduce((sum, venta) => {
        const costo = Number(venta.costoProducto) || 0;
        const cantidad = Number(venta.cantidadVendida) || 0;
        return sum + costo * cantidad;
      }, 0);

      const margenPromedioGlobal =
        totalCosto > 0 ? (totalGanancia / totalCosto) * 100 : 0;

      // AUDITORÍA: comparar suma por transacción vs objetivo
      try {
        const objetivos = new Map(); // id -> { objetivo, tipo }
        // objetivos para compras
        purchases.forEach((purchase) => {
          if (purchase?.total && Number(purchase.total) > 0) {
            objetivos.set(String(purchase._id), {
              objetivo: Math.round(Number(purchase.total)),
              tipo: 'Compra',
            });
          } else {
            const subtotal = (purchase?.products || []).reduce((s, p) => {
              const price = Number(p?.price) > 0 ? Number(p.price) : 0;
              const qty = Number(p?.quantity) || 0;
              return s + price * qty;
            }, 0);
            objetivos.set(String(purchase._id), {
              objetivo: Math.round(subtotal),
              tipo: 'Compra',
            });
          }
        });
        // objetivos para pagos
        payments.forEach((payment) => {
          const sumItems = (payment?.store || []).reduce((s, p) => {
            const price = Number(p?.price) > 0 ? Number(p.price) : 0;
            const qty = Number(p?.quantity) || 0;
            return s + price * qty;
          }, 0);
          const totalPay = Number(payment?.total) || 0;
          const efectivo =
            totalPay > 0 && totalPay < sumItems ? totalPay : sumItems;
          objetivos.set(String(payment._id), {
            objetivo: Math.round(efectivo),
            tipo: 'Pago Manual',
          });
        });

        const sumasPorId = new Map();
        ventasDetalladas.forEach((l) => {
          const id = String(l.idTransaccion);
          const actual = sumasPorId.get(id) || 0;
          sumasPorId.set(id, actual + (Number(l.totalVenta) || 0));
        });

        const diferencias: any[] = [];
        sumasPorId.forEach((suma, id) => {
          const obj = objetivos.get(id);
          if (!obj) return;
          const delta = Math.round(suma) - Math.round(obj.objetivo);
          if (delta !== 0) {
            diferencias.push({
              idTransaccion: id,
              tipo: obj.tipo,
              sumaDetalle: Math.round(suma),
              objetivo: Math.round(obj.objetivo),
              delta,
            });
          }
        });
        if (diferencias.length > 0) {
          console.warn(
            '[VentasDetalladas][AUDIT] Diferencias por transacción:',
            diferencias,
          );
        } else {
          console.warn(
            '[VentasDetalladas][AUDIT] Todas las transacciones cuadran con su objetivo.',
          );
        }
      } catch (e) {
        console.warn(
          '[VentasDetalladas][AUDIT] Error al auditar diferencias:',
          e?.message,
        );
      }

      // DEBUG: suma del detalle y verificación
      const sumaDetalle = ventasDetalladas.reduce(
        (s, v) => s + (Number(v.totalVenta) || 0),
        0,
      );
      const totalRedondeado = Math.round(totalFacturadoDetallado);
      console.warn(
        '[VentasDetalladas] sumaDetalle:',
        sumaDetalle,
        'totalFacturadoDetallado:',
        totalRedondeado,
        'coincide:',
        sumaDetalle === totalRedondeado,
      );

      const report = {
        ventasDetalladas: ventasOrdenadas,
        totalFacturado: Math.round(totalFacturadoDetallado),
        totalFacturadoSistema: Math.round(totalFacturadoDetallado),
        totalGanancia: Math.round(totalGanancia), // ✅ NUEVO CAMPO
        totalCosto: Math.round(totalCosto), // ✅ NUEVO CAMPO
        margenPromedioGlobal: Math.round(margenPromedioGlobal * 100) / 100, // ✅ NUEVO CAMPO
        cantidadTransacciones: purchases.length + payments.length,
        cantidadProductosVendidos: ventasDetalladas.length,
        fechaInicio: dateInit,
        fechaFin: dateEnd,
      };
      const pdfBuffer = await this.generateVentasDetalladasPDF(report);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="reporte-ventas-detalladas.pdf"',
      );
      res.setHeader('Content-Length', pdfBuffer.length);
      res.end(pdfBuffer);
    } catch (error) {}
  }

  private async generateVentasDetalladasPDF(report: any): Promise<Buffer> {
    const {
      ventasDetalladas = [],
      totalFacturado = 0,
      totalFacturadoSistema = 0,
      totalGanancia = 0, // ✅ NUEVO CAMPO
      totalCosto = 0, // ✅ NUEVO CAMPO
      margenPromedioGlobal = 0, // ✅ NUEVO CAMPO
      cantidadTransacciones = 0,
      cantidadProductosVendidos = 0,
      fechaInicio = '',
      fechaFin = '',
    } = report || {};

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    // Formateadores
    const fmtCOP = (n) => (Number(n) || 0).toLocaleString('es-CO');
    const fmtDateTime = (d) => {
      try {
        return new Date(d).toLocaleString('es-CO', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch {
        return '';
      }
    };

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8" />
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; font-size: 10px; }
            .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 12px; }
            .summary { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; margin: 15px 0; }
            .card { background: #f8f9fa; padding: 8px 10px; border-radius: 6px; min-width: 140px; }
            .card .label { color: #7f8c8d; font-size: 9px; }
            .card .value { color: #2c3e50; font-weight: bold; font-size: 12px; }
            .profit-card { background: #e8f5e8; }
            .profit-card .value { color: #27ae60; }
            table { width: 100%; border-collapse: collapse; font-size: 9px; margin-top: 15px; }
            th, td { border: 1px solid #ddd; padding: 4px; text-align: left; }
            th { background: #f0f3f6; text-transform: uppercase; font-size: 8px; font-weight: bold; }
            td.num { text-align: right; }
            .row-total { background: #eef9f0; font-weight: bold; }
            .positive-profit { color: #27ae60; font-weight: bold; }
            .negative-profit { color: #e74c3c; font-weight: bold; }
            .footer { margin-top: 18px; font-size: 8px; color: #666; text-align: center; border-top: 1px solid #ddd; padding-top: 10px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2>REPORTE DE VENTAS DETALLADAS CON ANÁLISIS DE RENTABILIDAD</h2>
            <div>Rango: ${fechaInicio} a ${fechaFin}</div>
          </div>
    
          <div class="summary">
            <div class="card"><div class="label">Total Facturado</div><div class="value">$ ${fmtCOP(totalFacturado)}</div></div>
            <div class="card profit-card"><div class="label">Total Ganancia</div><div class="value">$ ${fmtCOP(totalGanancia)}</div></div>
            <div class="card"><div class="label">Total Costo</div><div class="value">$ ${fmtCOP(totalCosto)}</div></div>
            <div class="card profit-card"><div class="label">Margen Promedio</div><div class="value">${margenPromedioGlobal.toFixed(2)}%</div></div>
            <div class="card"><div class="label">Transacciones</div><div class="value">${cantidadTransacciones}</div></div>
            <div class="card"><div class="label">Productos Vendidos</div><div class="value">${cantidadProductosVendidos}</div></div>
            <div class="card"><div class="label">Fecha Generación</div><div class="value">${new Date().toLocaleString('es-CO')}</div></div>
          </div>
    
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Usuario</th>
                <th>Tipo</th>
                <th>Producto</th>
                <th>Marca</th>
                <th>Cat.</th>
                <th>Tono</th>
                <th class="num">Cant</th>
                <th class="num">Costo Unit.</th>
                <th class="num">Precio Real</th>
                <th class="num">Precio Vend.</th>
                <th class="num">Total Venta</th>
                <th class="num">Ganancia Unit.</th>
                <th class="num">Ganancia Total</th>
                <th class="num">Margen %</th>
                <th>Tipo Desc.</th>
                <th class="num">% Desc.</th>
                <th>ID Trans.</th>
              </tr>
            </thead>
            <tbody>
              ${ventasDetalladas
                .map((v) => {
                  const gananciaPorUnidad = Number(v.gananciaPorUnidad) || 0;
                  const gananciaTotal = Number(v.gananciaTotal) || 0;
                  const margen = Number(v.margenGanancia) || 0;
                  const profitClass =
                    gananciaTotal >= 0 ? 'positive-profit' : 'negative-profit';

                  return `
                <tr>
                  <td>${fmtDateTime(v.fechaVenta)}</td>
                  <td>${v.usuario || ''}</td>
                  <td>${v.tipoTransaccion || ''}</td>
                  <td>${v.nombreProducto || ''}</td>
                  <td>${v.marca || ''}</td>
                  <td>${v.categoria || ''}</td>
                  <td>${v.tono || ''}</td>
                  <td class="num">${Number(v.cantidadVendida || 0)}</td>
                  <td class="num">$ ${fmtCOP(v.costoProducto)}</td>
                  <td class="num">$ ${fmtCOP(v.precioReal)}</td>
                  <td class="num">$ ${fmtCOP(v.precioVendido)}</td>
                  <td class="num">$ ${fmtCOP(v.totalVenta)}</td>
                  <td class="num ${profitClass}">$ ${fmtCOP(gananciaPorUnidad)}</td>
                  <td class="num ${profitClass}">$ ${fmtCOP(gananciaTotal)}</td>
                  <td class="num ${profitClass}">${margen.toFixed(2)}%</td>
                  <td>${v.tipoDescuento || ''}</td>
                  <td class="num">${(Number(v.porcentajeDescuento) || 0).toFixed(2)}%</td>
                  <td>${v.idTransaccion || ''}</td>
                </tr>
              `;
                })
                .join('')}
              <tr class="row-total">
                <td colspan="11">TOTALES</td>
                <td class="num">$ ${fmtCOP(totalFacturado)}</td>
                <td class="num"></td>
                <td class="num positive-profit">$ ${fmtCOP(totalGanancia)}</td>
                <td class="num positive-profit">${margenPromedioGlobal.toFixed(2)}%</td>
                <td colspan="3"></td>
              </tr>
            </tbody>
          </table>
    
          <div class="footer">
            Reporte generado automáticamente por el sistema • 
            Ganancia = Precio Vendido - Costo Unitario • 
            Margen = (Ganancia / Costo) × 100
          </div>
        </body>
        </html>
      `;

    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'A4',
      landscape: true, // ✅ CAMBIAR A HORIZONTAL PARA MÁS COLUMNAS
      margin: { top: '10mm', right: '8mm', bottom: '10mm', left: '8mm' },
      printBackground: true,
    });

    await browser.close();
    return Buffer.from(pdf);
  }

  async salesReportExcel(
    res: Response,
    req: Request,
    dateInit: string,
    dateEnd: string,
  ) {
    try {
      if (!dateInit || !dateEnd) {
        return res.status(400).json({
          success: false,
          info: 'Debes enviar dateInit y dateEnd en el query',
        });
      }

      // 1. Ajustar fechas a hora Colombia y convertir a UTC
      const start = moment
        .tz(dateInit, 'YYYY-MM-DD', 'America/Bogota')
        .startOf('day')
        .utc()
        .toDate();
      const end = moment
        .tz(dateEnd, 'YYYY-MM-DD', 'America/Bogota')
        .endOf('day')
        .utc()
        .toDate();

      // 2. Obtener compras con filtros (misma lógica que el PDF)
      const purchases = await this.purchaseModel
        .find({
          status: { $in: ['Aprobada', 'Despachada', 'Entregada'] },
          createdAt: { $gte: start, $lte: end },
          products: { $exists: true, $ne: null },
          $expr: { $gt: [{ $size: '$products' }, 0] },
          paymentMethod: { $nin: ['referred', '', null] },
        })
        .populate({
          path: 'products.id',
          model: 'Product',
          select:
            '_id name price discount brand category ref tone color costProduct',
          populate: [
            { path: 'brand', model: 'Brand', select: '_id name' },
            { path: 'category', model: 'Category', select: '_id name' },
            {
              path: 'ref',
              model: 'Product',
              select:
                '_id name price discount brand category tone color costProduct',
              populate: [
                { path: 'brand', model: 'Brand', select: '_id name' },
                { path: 'category', model: 'Category', select: '_id name' },
              ],
            },
          ],
        })
        .lean();

      // 2.1 Obtener pagos manuales con filtros
      const payments = await this.paymentModel
        .find({
          status: 'approved',
          createdAt: { $gte: start, $lte: end },
          isStore: true,
          store: { $exists: true, $ne: null },
          $expr: { $gt: [{ $size: '$store' }, 0] },
        })
        .populate({
          path: 'store.id',
          model: 'Product',
          select:
            '_id name price discount brand category ref tone color costProduct',
          populate: [
            { path: 'brand', model: 'Brand', select: '_id name' },
            { path: 'category', model: 'Category', select: '_id name' },
            {
              path: 'ref',
              model: 'Product',
              select:
                '_id name price discount brand category tone color costProduct',
              populate: [
                { path: 'brand', model: 'Brand', select: '_id name' },
                { path: 'category', model: 'Category', select: '_id name' },
              ],
            },
          ],
        })
        .populate({
          path: 'lastAdminEdit',
          model: 'User',
          select: '_id fullName email',
        })
        .lean();

      // 3. Array para el reporte detallado (misma lógica que el PDF)
      const ventasDetalladas: any[] = [];

      // 4. Procesar cada compra (reutilizar la lógica completa del método PDF)
      purchases.forEach((purchase: any) => {
        let totalCompra = 0;

        if (purchase.total && purchase.total > 0) {
          totalCompra = Number(purchase.total);

          // Calcular suma con precios de productos (puede tener descuentos individuales)
          const sumaConDescuentosIndividuales = purchase.products.reduce(
            (sum, prod) => {
              const product = prod.id;
              if (!product) return sum;
              const main = product.ref || product;
              const precioReal = Number(main.price) || 0;
              const descuentoProductoRaw =
                (product?.ref?.discount != null
                  ? Number(product.ref.discount)
                  : product?.discount != null
                    ? Number(product.discount)
                    : 0) || 0;
              const factorDescuentoProducto =
                descuentoProductoRaw > 0
                  ? descuentoProductoRaw <= 1
                    ? descuentoProductoRaw
                    : descuentoProductoRaw <= 100
                      ? descuentoProductoRaw / 100
                      : 1
                  : 0;
              const precioDerivadoPorDescuento = Math.round(
                precioReal * (1 - factorDescuentoProducto),
              );
              const priceLinea =
                Number(prod.price) > 0 ? Number(prod.price) : null;
              const precioProducto =
                factorDescuentoProducto > 0
                  ? priceLinea === null
                    ? precioDerivadoPorDescuento
                    : Math.min(priceLinea, precioDerivadoPorDescuento)
                  : priceLinea === null
                    ? precioReal
                    : priceLinea;
              const cantidad = Number(prod.quantity) || 0;
              return sum + precioProducto * cantidad;
            },
            0,
          );

          // Determinar si hay descuento a nivel de compra
          const hayDescuentoCompra =
            totalCompra > 0 &&
            sumaConDescuentosIndividuales > 0 &&
            totalCompra < sumaConDescuentosIndividuales;
          const factorDescuentoCompra = hayDescuentoCompra
            ? totalCompra / sumaConDescuentosIndividuales
            : 1;

          // Procesar productos para el detalle aplicando factor si corresponde
          const lineasCompra: any[] = [];
          let sumaLineasRedondeadas = 0;
          purchase.products.forEach((prod) => {
            const product = prod.id;
            if (!product) return;
            const main = product.ref || product;
            const precioReal = Number(main.price) || 0;
            const cantidad = Number(prod.quantity) || 0;
            const costoProducto = Number(main.costProduct) || 0;

            // Precio con descuento individual
            const descuentoProductoRaw = Number(main.discount) || 0;
            const factorDescuentoProducto =
              descuentoProductoRaw > 0
                ? descuentoProductoRaw <= 1
                  ? descuentoProductoRaw
                  : descuentoProductoRaw <= 100
                    ? descuentoProductoRaw / 100
                    : 1
                : 0;
            const precioDerivadoPorDescuento = Math.round(
              precioReal * (1 - factorDescuentoProducto),
            );
            const priceLinea =
              Number(prod.price) > 0 ? Number(prod.price) : null;
            let precioConDescuentoIndividual =
              priceLinea === null ? precioDerivadoPorDescuento : priceLinea;
            if (factorDescuentoProducto > 0) {
              const preferido = precioDerivadoPorDescuento;
              if (priceLinea === null || preferido < priceLinea) {
                precioConDescuentoIndividual = preferido;
              }
            }

            // Precio final considerando ambos tipos de descuento
            let precioFinalVendido = precioConDescuentoIndividual;
            let tipoDescuento = 'Sin descuento';
            let porcentajeDescuento = 0;
            const hayDescuentoIndividual =
              precioConDescuentoIndividual < precioReal;

            if (hayDescuentoCompra) {
              precioFinalVendido =
                precioConDescuentoIndividual * factorDescuentoCompra;
              tipoDescuento = hayDescuentoIndividual
                ? 'Ambos'
                : 'Descuento en compra';
              porcentajeDescuento = (1 - precioFinalVendido / precioReal) * 100;
            } else if (hayDescuentoIndividual) {
              tipoDescuento = 'Descuento individual';
              porcentajeDescuento =
                ((precioReal - precioConDescuentoIndividual) / precioReal) *
                100;
            }

            const totalProd = precioFinalVendido * cantidad;
            const totalProdRedondeado = Math.round(totalProd);
            const precioVendidoRedondeado = Math.round(precioFinalVendido);

            // Calcular ganancia
            const gananciaPorUnidad = precioVendidoRedondeado - costoProducto;
            const gananciaTotal = gananciaPorUnidad * cantidad;
            const margenGanancia =
              costoProducto > 0 ? (gananciaPorUnidad / costoProducto) * 100 : 0;

            const linea: any = {
              nombreProducto: main.name?.trim() || 'Producto sin nombre',
              marca: main.brand?.name?.trim() || 'Sin marca',
              cantidadVendida: cantidad,
              precioReal,
              precioVendido: precioVendidoRedondeado,
              totalVenta: totalProdRedondeado,
              costoProducto,
              gananciaPorUnidad,
              gananciaTotal,
              margenGanancia: Math.round(margenGanancia * 100) / 100,
              tono: (
                product.color?.name ||
                product.tone?.name ||
                'Sin tono'
              ).trim(),
              categoria: main.category?.name?.trim() || 'Sin categoría',
              tipoTransaccion: 'Compra',
              fechaVenta: purchase.createdAt,
              idTransaccion: purchase._id,
              usuario: purchase.user?.fullName || '',
              tipoDescuento,
              porcentajeDescuento: Math.round(porcentajeDescuento * 100) / 100,
            };

            lineasCompra.push(linea);
            sumaLineasRedondeadas += totalProdRedondeado;
          });

          // Reconciliar para que la suma de líneas coincida con purchase.total
          const objetivo = totalCompra;
          const diferencia =
            Math.round(objetivo) - Math.round(sumaLineasRedondeadas);
          if (lineasCompra.length > 0 && diferencia !== 0) {
            const idx = lineasCompra.length - 1;
            const lineaAjuste = lineasCompra[idx];
            const nuevoTotal = Math.max(0, lineaAjuste.totalVenta + diferencia);
            const qty = Number(lineaAjuste.cantidadVendida) || 1;
            const nuevoPrecioVendido = Math.round(nuevoTotal / qty);

            // Recalcular ganancia después del ajuste
            const nuevaGananciaPorUnidad =
              nuevoPrecioVendido - lineaAjuste.costoProducto;
            const nuevaGananciaTotal = nuevaGananciaPorUnidad * qty;
            const nuevoMargenGanancia =
              lineaAjuste.costoProducto > 0
                ? (nuevaGananciaPorUnidad / lineaAjuste.costoProducto) * 100
                : 0;

            lineaAjuste.totalVenta = nuevoTotal;
            lineaAjuste.precioVendido = nuevoPrecioVendido;
            lineaAjuste.gananciaPorUnidad = nuevaGananciaPorUnidad;
            lineaAjuste.gananciaTotal = nuevaGananciaTotal;
            lineaAjuste.margenGanancia =
              Math.round(nuevoMargenGanancia * 100) / 100;

            lineasCompra[idx] = lineaAjuste;
          }

          ventasDetalladas.push(...lineasCompra);
        } else {
          // Calcular por productos cuando no hay purchase.total válido
          const lineasCompraSinTotal: any[] = [];
          purchase.products.forEach((prod: any) => {
            const product = prod.id;
            if (!product) return;
            const main = product.ref || product;
            const precioReal = Number(main.price) || 0;
            const costoProducto = Number(main.costProduct) || 0;
            const priceLinea =
              Number(prod.price) > 0 ? Number(prod.price) : null;
            const precioVendido = priceLinea === null ? precioReal : priceLinea;
            const cantidad = Number(prod.quantity) || 0;
            const totalProd = precioVendido * cantidad;
            totalCompra += totalProd;

            // Calcular ganancia
            const gananciaPorUnidad = precioVendido - costoProducto;
            const gananciaTotal = gananciaPorUnidad * cantidad;
            const margenGanancia =
              costoProducto > 0 ? (gananciaPorUnidad / costoProducto) * 100 : 0;

            const totalProdRedondeado = Math.round(totalProd);
            const precioVendidoRedondeado = Math.round(precioVendido);
            const linea2: any = {
              nombreProducto: main.name?.trim() || 'Producto sin nombre',
              marca: main.brand?.name?.trim() || 'Sin marca',
              cantidadVendida: cantidad,
              precioReal,
              precioVendido: precioVendidoRedondeado,
              totalVenta: totalProdRedondeado,
              costoProducto,
              gananciaPorUnidad: Math.round(gananciaPorUnidad),
              gananciaTotal: Math.round(gananciaTotal),
              margenGanancia: Math.round(margenGanancia * 100) / 100,
              tono: (
                product.color?.name ||
                product.tone?.name ||
                'Sin tono'
              ).trim(),
              categoria: main.category?.name?.trim() || 'Sin categoría',
              tipoTransaccion: 'Compra',
              fechaVenta: purchase.createdAt,
              idTransaccion: purchase._id,
              usuario: purchase.user?.fullName || '',
              tipoDescuento:
                priceLinea !== null && priceLinea < precioReal
                  ? 'Descuento individual'
                  : 'Sin descuento',
              porcentajeDescuento:
                priceLinea !== null && priceLinea < precioReal
                  ? Math.round(
                      ((precioReal - priceLinea) / precioReal) * 100 * 100,
                    ) / 100
                  : 0,
            };
            lineasCompraSinTotal.push(linea2);
          });

          // Reconciliar suma de líneas
          const objetivo2 = Math.round(totalCompra);
          const sumaRedondeada2 = lineasCompraSinTotal.reduce(
            (s, l) => s + (Number(l.totalVenta) || 0),
            0,
          );
          if (
            lineasCompraSinTotal.length > 0 &&
            sumaRedondeada2 !== objetivo2
          ) {
            const idx2 = lineasCompraSinTotal.length - 1;
            const lineaAjuste2 = lineasCompraSinTotal[idx2];
            const nuevoTotal2 = Math.max(
              0,
              lineaAjuste2.totalVenta + (objetivo2 - sumaRedondeada2),
            );
            const qty2 = Number(lineaAjuste2.cantidadVendida) || 1;
            const nuevoPrecioVendido2 = Math.round(nuevoTotal2 / qty2);

            // Recalcular ganancia después del ajuste
            const nuevaGananciaPorUnidad2 =
              nuevoPrecioVendido2 - lineaAjuste2.costoProducto;
            const nuevaGananciaTotal2 = nuevaGananciaPorUnidad2 * qty2;
            const nuevoMargenGanancia2 =
              lineaAjuste2.costoProducto > 0
                ? (nuevaGananciaPorUnidad2 / lineaAjuste2.costoProducto) * 100
                : 0;

            lineaAjuste2.totalVenta = nuevoTotal2;
            lineaAjuste2.precioVendido = nuevoPrecioVendido2;
            lineaAjuste2.gananciaPorUnidad = nuevaGananciaPorUnidad2;
            lineaAjuste2.gananciaTotal = nuevaGananciaTotal2;
            lineaAjuste2.margenGanancia =
              Math.round(nuevoMargenGanancia2 * 100) / 100;

            lineasCompraSinTotal[idx2] = lineaAjuste2;
          }
          ventasDetalladas.push(...lineasCompraSinTotal);
        }
      });

      // 4.1 Procesar cada pago manual (misma lógica que el PDF)
      payments.forEach((payment: any) => {
        const totalPayment = Number(payment.total) || 0;

        const sumItemsLinea = payment.store.reduce((s, p) => {
          const price = Number(p?.price) > 0 ? Number(p.price) : 0;
          const qty = Number(p?.quantity) || 0;
          return s + price * qty;
        }, 0);

        const hayDescuentoPago =
          totalPayment > 0 && totalPayment < sumItemsLinea;
        const factorDescuentoPago = hayDescuentoPago
          ? totalPayment / sumItemsLinea
          : 1;

        const lineasPago: any[] = [];
        let sumaLineasPago = 0;
        payment.store.forEach((prod: any) => {
          const product = prod.id;
          if (!product) return;
          const main = product.ref || product;
          const precioReal = Number(main.price) || 0;
          const costoProducto = Number(main.costProduct) || 0;
          const cantidad = Number(prod.quantity) || 0;

          const priceLinea = Number(prod.price) > 0 ? Number(prod.price) : null;
          let precioConDescuentoIndividual = precioReal;

          if (
            priceLinea !== null &&
            priceLinea > 0 &&
            priceLinea < precioReal
          ) {
            precioConDescuentoIndividual = priceLinea;
          }

          let precioFinalVendido = precioConDescuentoIndividual;
          let tipoDescuento = 'Sin descuento';
          let porcentajeDescuento = 0;
          const hayDescuentoIndividual =
            precioConDescuentoIndividual < precioReal;

          if (hayDescuentoPago) {
            precioFinalVendido =
              precioConDescuentoIndividual * factorDescuentoPago;
            tipoDescuento = hayDescuentoIndividual
              ? 'Ambos'
              : 'Descuento en pago';
            porcentajeDescuento =
              Math.round((1 - precioFinalVendido / precioReal) * 100 * 100) /
              100;
          } else if (hayDescuentoIndividual) {
            tipoDescuento = 'Descuento individual';
            porcentajeDescuento =
              Math.round(
                (1 - precioConDescuentoIndividual / precioReal) * 100 * 100,
              ) / 100;
          }

          const totalProd = precioFinalVendido * cantidad;
          const totalProdRedondeado = Math.round(totalProd);
          const precioVendidoFinal = Math.round(precioFinalVendido);

          // Calcular ganancia
          const gananciaPorUnidad = precioVendidoFinal - costoProducto;
          const gananciaTotal = gananciaPorUnidad * cantidad;
          const margenGanancia =
            costoProducto > 0 ? (gananciaPorUnidad / costoProducto) * 100 : 0;

          const lineaPago: any = {
            nombreProducto: main.name?.trim() || 'Producto sin nombre',
            marca: main.brand?.name?.trim() || 'Sin marca',
            cantidadVendida: cantidad,
            precioReal,
            precioVendido: precioVendidoFinal,
            totalVenta: totalProdRedondeado,
            costoProducto,
            gananciaPorUnidad,
            gananciaTotal,
            margenGanancia: Math.round(margenGanancia * 100) / 100,
            tono: (
              product.color?.name ||
              product.tone?.name ||
              'Sin tono'
            ).trim(),
            categoria: main.category?.name?.trim() || 'Sin categoría',
            tipoTransaccion: 'Pago Manual',
            fechaVenta: payment.createdAt,
            idTransaccion: payment._id,
            usuario: payment.lastAdminEdit?.fullName || '',
            tipoDescuento,
            porcentajeDescuento: Math.round(porcentajeDescuento * 100) / 100,
          };

          lineasPago.push(lineaPago);
          sumaLineasPago += totalProdRedondeado;
        });

        // Reconciliar líneas de pago
        const objetivoPago = Math.round(
          hayDescuentoPago ? totalPayment : sumItemsLinea,
        );
        const diferenciaPago = objetivoPago - Math.round(sumaLineasPago);
        if (lineasPago.length > 0 && diferenciaPago !== 0) {
          const idx = lineasPago.length - 1;
          const linea = lineasPago[idx];
          const nuevoTotal = Math.max(0, linea.totalVenta + diferenciaPago);
          const qty = Number(linea.cantidadVendida) || 1;
          const nuevoPrecioVendido = Math.round(nuevoTotal / qty);

          // Recalcular ganancia después del ajuste
          const nuevaGananciaPorUnidad =
            nuevoPrecioVendido - linea.costoProducto;
          const nuevaGananciaTotal = nuevaGananciaPorUnidad * qty;
          const nuevoMargenGanancia =
            linea.costoProducto > 0
              ? (nuevaGananciaPorUnidad / linea.costoProducto) * 100
              : 0;

          linea.totalVenta = nuevoTotal;
          linea.precioVendido = nuevoPrecioVendido;
          linea.gananciaPorUnidad = nuevaGananciaPorUnidad;
          linea.gananciaTotal = nuevaGananciaTotal;
          linea.margenGanancia = Math.round(nuevoMargenGanancia * 100) / 100;

          lineasPago[idx] = linea;
        }
        ventasDetalladas.push(...lineasPago);
      });

      // 5. Ordenar por fecha más reciente y calcular totales
      const ventasOrdenadas = ventasDetalladas.sort(
        (a, b) =>
          new Date(b.fechaVenta).getTime() - new Date(a.fechaVenta).getTime(),
      );

      // Calcular totales
      const totalComprasAgregado = purchases.reduce((sum, purchase: any) => {
        if (purchase?.total && Number(purchase.total) > 0) {
          return sum + Number(purchase.total);
        }
        const subtotal = (purchase?.products || []).reduce((s, p) => {
          const price = Number(p?.price) > 0 ? Number(p.price) : 0;
          const qty = Number(p?.quantity) || 0;
          return s + price * qty;
        }, 0);
        return sum + subtotal;
      }, 0);

      const totalPagosAgregado = payments.reduce((sum, payment) => {
        const sumItems = (payment?.store || []).reduce((s, p) => {
          const price = Number(p?.price) > 0 ? Number(p.price) : 0;
          const qty = Number(p?.quantity) || 0;
          return s + price * qty;
        }, 0);
        const totalPay = Number(payment?.total) || 0;
        const efectivo =
          totalPay > 0 && totalPay < sumItems ? totalPay : sumItems;
        return sum + efectivo;
      }, 0);

      const totalFacturadoDetallado = totalComprasAgregado + totalPagosAgregado;

      // Calcular totales de ganancia
      const totalGanancia = ventasDetalladas.reduce((sum, venta) => {
        return sum + (Number(venta.gananciaTotal) || 0);
      }, 0);

      const totalCosto = ventasDetalladas.reduce((sum, venta) => {
        const costo = Number(venta.costoProducto) || 0;
        const cantidad = Number(venta.cantidadVendida) || 0;
        return sum + costo * cantidad;
      }, 0);

      const margenPromedioGlobal =
        totalCosto > 0 ? (totalGanancia / totalCosto) * 100 : 0;

      // 6. Crear el archivo Excel
      const excelData = this.generateExcelData(ventasOrdenadas, {
        totalFacturado: Math.round(totalFacturadoDetallado),
        totalGanancia: Math.round(totalGanancia),
        totalCosto: Math.round(totalCosto),
        margenPromedioGlobal: Math.round(margenPromedioGlobal * 100) / 100,
        cantidadTransacciones: purchases.length + payments.length,
        cantidadProductosVendidos: ventasDetalladas.length,
        fechaInicio: dateInit,
        fechaFin: dateEnd,
      });

      // 7. Generar archivo Excel
      const workbook = XLSX.utils.book_new();

      // Hoja principal con los datos detallados
      const worksheet = XLSX.utils.json_to_sheet(excelData.detailData);
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Ventas Detalladas');

      // Hoja de resumen
      const summaryWorksheet = XLSX.utils.json_to_sheet(excelData.summaryData);
      XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Resumen');

      // Convertir a buffer
      const excelBuffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
      });

      // 8. Enviar respuesta
      const fileName = `reporte-ventas-detalladas-${dateInit}-${dateEnd}.xlsx`;

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${fileName}"`,
      );
      res.setHeader('Content-Length', excelBuffer.length);
      res.end(excelBuffer);
    } catch (error) {
      console.error('Error generando reporte Excel:', error);
      return res.status(500).json({
        success: false,
        info: 'Error interno del servidor al generar el reporte Excel',
      });
    }
  }

  private generateExcelData(ventasDetalladas: any[], totals: any) {
    // Formatear fecha para Excel
    const formatDate = (date: any) => {
      try {
        return new Date(date).toLocaleDateString('es-CO', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch {
        return '';
      }
    };

    // Datos detallados
    const detailData = ventasDetalladas.map((venta) => ({
      Fecha: formatDate(venta.fechaVenta),
      Usuario: venta.usuario || '',
      'Tipo Transacción': venta.tipoTransaccion || '',
      Producto: venta.nombreProducto || '',
      Marca: venta.marca || '',
      Categoría: venta.categoria || '',
      Tono: venta.tono || '',
      Cantidad: Number(venta.cantidadVendida || 0),
      'Costo Unitario': Number(venta.costoProducto || 0),
      'Precio Real': Number(venta.precioReal || 0),
      'Precio Vendido': Number(venta.precioVendido || 0),
      'Total Venta': Number(venta.totalVenta || 0),
      'Ganancia Unitaria': Number(venta.gananciaPorUnidad || 0),
      'Ganancia Total': Number(venta.gananciaTotal || 0),
      'Margen %': Number(venta.margenGanancia || 0),
      'Tipo Descuento': venta.tipoDescuento || '',
      '% Descuento': Number(venta.porcentajeDescuento || 0),
      'ID Transacción': String(venta.idTransaccion || ''),
    }));

    // Datos de resumen
    const summaryData = [
      { Concepto: 'Total Facturado', Valor: totals.totalFacturado },
      { Concepto: 'Total Ganancia', Valor: totals.totalGanancia },
      { Concepto: 'Total Costo', Valor: totals.totalCosto },
      {
        Concepto: 'Margen Promedio Global (%)',
        Valor: totals.margenPromedioGlobal,
      },
      {
        Concepto: 'Cantidad de Transacciones',
        Valor: totals.cantidadTransacciones,
      },
      {
        Concepto: 'Cantidad de Productos Vendidos',
        Valor: totals.cantidadProductosVendidos,
      },
      { Concepto: 'Fecha Inicio', Valor: totals.fechaInicio },
      { Concepto: 'Fecha Fin', Valor: totals.fechaFin },
      {
        Concepto: 'Fecha de Generación',
        Valor: new Date().toLocaleString('es-CO'),
      },
    ];

    return {
      detailData,
      summaryData,
    };
  }
}
