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
          select: '_id name price discount brand category ref tone color',
          populate: [
            { path: 'brand', model: 'Brand', select: '_id name' },
            { path: 'category', model: 'Category', select: '_id name' },
            {
              path: 'ref',
              model: 'Product',
              select: '_id name price discount brand category tone color',
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
          select: '_id name price discount brand category ref tone color',
          populate: [
            { path: 'brand', model: 'Brand', select: '_id name' },
            { path: 'category', model: 'Category', select: '_id name' },
            {
              path: 'ref',
              model: 'Product',
              select: '_id name price discount   brand category tone color',
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

            // Preparar línea (se insertará luego de reconciliar)
            const linea: any = {
              nombreProducto: main.name?.trim() || 'Producto sin nombre',
              marca: main.brand?.name?.trim() || 'Sin marca',
              cantidadVendida: cantidad,
              precioReal,
              precioVendido: precioVendidoRedondeado,
              totalVenta: totalProdRedondeado,
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
            lineaAjuste.totalVenta = nuevoTotal;
            lineaAjuste.precioVendido = Math.round(nuevoTotal / qty);
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
            const priceLinea =
              Number(prod.price) > 0 ? Number(prod.price) : null;
            const precioVendido = priceLinea === null ? precioReal : priceLinea; // sin descuentos derivados
            const cantidad = Number(prod.quantity) || 0;
            const totalProd = precioVendido * cantidad;
            totalCompra += totalProd;

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
            lineaAjuste2.totalVenta = nuevoTotal2;
            lineaAjuste2.precioVendido = Math.round(nuevoTotal2 / qty2);
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

          // ✅ AGREGAR AL REPORTE DETALLADO (con auditoría opcional)
          const lineaPago: any = {
            nombreProducto: main.name?.trim() || 'Producto sin nombre',
            marca: main.brand?.name?.trim() || 'Sin marca',
            cantidadVendida: cantidad,
            precioReal,
            precioVendido: Math.round(precioFinalVendido),
            totalVenta: totalProdRedondeado,
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
          linea.totalVenta = nuevoTotal;
          linea.precioVendido = Math.round(nuevoTotal / qty);
          lineasPago[idx] = linea;
        }
        ventasDetalladas.push(...lineasPago);
      });

      // 5. Ordenar por fecha más reciente y calcular totales alineados con las agregaciones de MongoDB
      const ventasOrdenadas = ventasDetalladas.sort(
        (a, b) => new Date(b.fechaVenta).getTime() - new Date(a.fechaVenta).getTime(),
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
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; font-size: 11px; }
            .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 12px; }
            .summary { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; margin: 15px 0; }
            .card { background: #f8f9fa; padding: 10px 12px; border-radius: 6px; min-width: 180px; }
            .card .label { color: #7f8c8d; font-size: 10px; }
            .card .value { color: #2c3e50; font-weight: bold; font-size: 14px; }
            table { width: 100%; border-collapse: collapse; font-size: 10px; }
            th, td { border: 1px solid #ddd; padding: 6px; text-align: left; }
            th { background: #f0f3f6; text-transform: uppercase; font-size: 9px; }
            td.num { text-align: right; }
            .row-total { background: #eef9f0; font-weight: bold; }
            .footer { margin-top: 18px; font-size: 9px; color: #666; text-align: center; border-top: 1px solid #ddd; padding-top: 10px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2>REPORTE DE VENTAS DETALLADAS</h2>
            <div>Rango: ${fechaInicio} a ${fechaFin}</div>
          </div>
    
          <div class="summary">
            <div class="card"><div class="label">Total Facturado (líneas)</div><div class="value">$ ${fmtCOP(totalFacturado)}</div></div>
            <div class="card"><div class="label">Total Facturado (sistema)</div><div class="value">$ ${fmtCOP(totalFacturadoSistema)}</div></div>
            <div class="card"><div class="label">Transacciones</div><div class="value">${cantidadTransacciones}</div></div>
            <div class="card"><div class="label">Productos Vendidos</div><div class="value">${cantidadProductosVendidos}</div></div>
            <div class="card"><div class="label">Fecha Generación</div><div class="value">${new Date().toLocaleString('es-CO')}</div></div>
          </div>
    
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Usuario</th>
                <th>Transacción</th>
                <th>Producto</th>
                <th>Marca</th>
                <th>Categoría</th>
                <th>Tono/Color</th>
                <th class="num">Cant</th>
                <th class="num">Precio Real</th>
                <th class="num">Precio Base</th>
                <th>Tipo Desc.</th>
                <th class="num">% Desc.</th>
                <!-- <th class="num">Factor Doc.</th> -->
                <th class="num">Precio Vendido</th>
                <th class="num">Total Línea</th>
                <th>ID Transacción</th> 
              </tr>
            </thead>
            <tbody>
              ${ventasDetalladas
                .map(
                  (v) => `
                <tr>
                  <td>${fmtDateTime(v.fechaVenta)}</td>
                  <td>${v.usuario || ''}</td>
                  <td>${v.tipoTransaccion || ''}</td>
                  <td>${v.nombreProducto || ''}</td>
                  <td>${v.marca || ''}</td>
                  <td>${v.categoria || ''}</td>
                  <td>${v.tono || ''}</td>
                  <td class="num">${Number(v.cantidadVendida || 0)}</td>
                  <td class="num">$ ${fmtCOP(v.precioReal)}</td>
                  <td class="num">$ ${fmtCOP(v.precioConDescuentoIndividual)}</td>
                  <td>${v.tipoDescuento || ''}</td>
                  <td class="num">${(Number(v.porcentajeDescuento) || 0).toFixed(2)}%</td>
                  <!-- <td class="num">${v.hayDescuentoCompra ? Number(v.factorDescuentoCompra || 1).toFixed(4) : '-'}</td> -->
                  <td class="num">$ ${fmtCOP(v.precioVendido)}</td>
                  <td class="num">$ ${fmtCOP(v.totalVenta)}</td>
                  <td>${v.idTransaccion || ''}</td>
                </tr>
              `,
                )
                .join('')}
              <tr class="row-total">
                <td colspan="13">TOTAL</td>
                <td class="num">$ ${fmtCOP(totalFacturado)}</td>
                <td class="num"></td>
              </tr>
            </tbody>
          </table>
    
          <div class="footer">
            Reporte generado automáticamente por el sistema
          </div>
        </body>
        </html>
      `;

    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'A4',
      margin: { top: '15mm', right: '10mm', bottom: '15mm', left: '10mm' },
      printBackground: true,
    });

    await browser.close();
    return Buffer.from(pdf);
  }
}
