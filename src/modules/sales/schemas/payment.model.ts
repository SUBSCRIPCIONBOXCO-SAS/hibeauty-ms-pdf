import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PaymentDocument = Payment & Document;

@Schema({
  timestamps: true,
  toObject: { virtuals: true },
  toJSON: { virtuals: true }
})
export class Payment {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ type: Date, required: true })
  paymentDate: Date;

  @Prop({ type: Boolean, default: false })
  uponDelivery: boolean;

  @Prop({ type: String })
  comment?: string;

  @Prop({ type: Types.ObjectId, ref: 'Plan' })
  plan?: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['pending', 'approved', 'cancelled'],
    default: 'pending'
  })
  status: string;

  @Prop({
    type: [
      {
        id: { type: Types.ObjectId, ref: 'Product', required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
        tone: {
          code: { type: String },
          name: { type: String },
          hexCode: { type: String }
        }
      }
    ]
  })
  store: {
    id: Types.ObjectId;
    quantity: number;
    price: number;
    tone?: {
      code?: string;
      name?: string;
      hexCode?: string;
    };
  }[];

  @Prop({
    type: {
      url: { type: String },
      key: { type: String }
    }
  })
  voucher?: {
    url?: string;
    key?: string;
  };

  @Prop({ type: Number, required: true })
  total: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  lastAdminEdit?: Types.ObjectId;

  @Prop({ type: Boolean })
  doNotDispatch?: boolean;

  @Prop({ type: Boolean })
  discountApplied?: boolean;

  @Prop({ type: Boolean, default: false })
  isStore: boolean;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
