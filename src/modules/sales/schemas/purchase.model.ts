import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class Purchase extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ unique: true })
  code: string;

  @Prop({
    type: [
      {
        id: { type: Types.ObjectId, ref: 'Product', required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
        discount: Number,
        name: String,
        tone: {
          code: String,
          name: String,
          hexCode: String,
        },
      },
    ],
  })
  products: any[];

  @Prop({
    type: {
      address: { type: String, default: '' },
      city: { type: String, default: '' },
      department: { type: String, default: '' },
      neighborhood: { type: String, default: '' },
      zipCode: { type: String, default: '' },
      reference: { type: String, default: '' },
    },
  })
  sendAddress: {
    address?: string;
    city?: string;
    department?: string;
    neighborhood?: string;
    zipCode?: string;
    reference?: string;
  };

  @Prop({ type: Types.ObjectId, ref: 'Coupon' })
  coupon: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Shipmentdata' })
  guide: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['Pendiente','Aprobada','Declinada','Despachada','Entregada','Alistando','Devolucion'],
    default: 'Pendiente',
  })
  status: string;

  @Prop({
    type: [
      {
        status: { type: String, enum: ['Pendiente','Aprobada','Declinada','Despachada','Entregada','Alistando','Devolucion'] },
        date: { type: Date, default: Date.now },
        index: Number,
      },
    ],
  })
  timeLine: any[];

  @Prop({ type: String, enum: ['Unanswered', 'Recovered', 'Pending'], default: 'Pending' })
  paymentRecovered: string;

  @Prop({
    type: String,
    enum: [
      'creditCard', 'nequi', 'pse', 'bancolombia', 'bancolombia_qr',
      'daviplata', 'wompi', 'bitcoin', 'efecty', 'contraentrega',
      'addi', 'card', 'referred',
    ],
  })
  paymentMethod: string;

  @Prop({ type: Number, required: true, min: 0 })
  total: number;

  @Prop({ type: Types.ObjectId, ref: 'Subscription' })
  subscription: Types.ObjectId;

  @Prop({ type: String, enum: ['debito', 'credito'] })
  type: string;

  @Prop({ default: false })
  box: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Box' })
  nextBox: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Box' })
  currentBox: Types.ObjectId;

  @Prop({ default: false })
  add: boolean;
}

export const PurchaseSchema = SchemaFactory.createForClass(Purchase);
