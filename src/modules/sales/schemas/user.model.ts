import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserDocument = User & Document;

@Schema({
  timestamps: true,
  toObject: { virtuals: true },
  toJSON: { virtuals: true }
})
export class User {
  @Prop({ required: true, type: String })
  email: string;

  @Prop({ required: true, type: String })
  fullName: string;

  @Prop({ type: String, default: null })
  document?: string;

  @Prop({ type: Date, default: null })
  dateBirth?: Date;

  @Prop({ type: String })
  photo?: string;

  @Prop({ type: String })
  instagram?: string;

  @Prop({ type: [Object] })
  questions?: object[];

  @Prop({ type: String })
  phone?: string;

  @Prop({ type: Types.ObjectId, ref: 'Subscription' })
  subscription?: Types.ObjectId;

  @Prop({ type: String })
  code?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  referred?: Types.ObjectId;

  @Prop({
    type: {
      facebook: { type: String },
      google: { type: String },
      apple: { type: String }
    }
  })
  services?: {
    facebook?: string;
    google?: string;
    apple?: string;
  };

  @Prop({
    type: String,
    default: 'user',
    enum: ['user', 'admin', 'sales', 'logistics', 'marketing', 'customerService']
  })
  role: string;

  @Prop({ required: true, type: String })
  password: string;

  @Prop({ type: String, default: null })
  securityToken?: string;

  @Prop({ type: Boolean, default: true })
  accept: boolean;

  @Prop({ type: Number, default: 0 })
  reCount: number;

  @Prop({ type: String })
  process?: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Product' }] })
  favorites?: Types.ObjectId[];

  @Prop({
    type: {
      number: { type: String, default: '' },
      document: { type: String, default: '' }
    }
  })
  nequi?: {
    number?: string;
    document?: string;
  };

  @Prop({
    type: [
      {
        address: { type: String, default: '' },
        city: { type: String, default: '' },
        department: { type: String, default: '' },
        neighborhood: { type: String, default: '' },
        reference: { type: String, default: '' }
      }
    ]
  })
  myAddresses?: {
    address?: string;
    city?: string;
    department?: string;
    neighborhood?: string;
    reference?: string;
  }[];

  @Prop({
    type: {
      address: { type: String, default: '' },
      city: { type: String, default: '' },
      department: { type: String, default: '' },
      neighborhood: { type: String, default: '' },
      zipCode: { type: String, default: '' },
      reference: { type: String, default: '' }
    }
  })
  sendAddress?: {
    address?: string;
    city?: string;
    department?: string;
    neighborhood?: string;
    zipCode?: string;
    reference?: string;
  };

  @Prop({
    type: {
      subscriptionPaused: { type: Boolean, default: false },
      subscriptionPausedAt: { type: Date, default: null }
    }
  })
  requestToPauseSubscription?: {
    subscriptionPaused?: boolean;
    subscriptionPausedAt?: Date;
  };

  @Prop({ type: Boolean, default: false })
  star: boolean;

  @Prop({ type: Number, default: 0 })
  consecutivePayments: number;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Loyalty' }] })
  loyalties?: Types.ObjectId[];

  @Prop({
    type: {
      os: { type: String, default: null },
      version: { type: String, default: null }
    }
  })
  app_info?: {
    os?: string;
    version?: string;
  };

  @Prop({ type: [String] })
  coupons?: string[];

  @Prop({ type: Boolean, default: false })
  conflictive: boolean;

  @Prop({ type: String })
  tokenMobile?: string;

  @Prop({ type: Boolean, default: true })
  notification: boolean;

  @Prop({ type: Boolean, default: true })
  state: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  lastAdminToEditUser?: Types.ObjectId;

  @Prop({ type: String, default: null })
  reason?: string;

  @Prop({ type: Boolean, default: true })
  roulette: boolean;

  @Prop({ type: Boolean, default: false })
  voicer: boolean;

  @Prop({ type: Boolean, default: false })
  isReferred: boolean;

  @Prop({ type: Boolean, default: true })
  isNewUser: boolean;

  @Prop({
    type: String,
    default: 'notContacted',
    enum: ['contacted', 'notContacted']
  })
  isContacted: string;

  @Prop({ type: Boolean, default: false })
  isSubscription: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
