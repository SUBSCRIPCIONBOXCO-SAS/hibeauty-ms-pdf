import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProductDocument = Product & Document;

@Schema({
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})
export class Product {
  @Prop({ required: true, type: String })
  name: string;

  @Prop({ required: true, type: String })
  description: string;

  @Prop({ type: Number, default: 0, min: 0 })
  stock: number;

  @Prop({ type: Number, default: 0 })
  stockReferred: number;

  @Prop({
    type: {
      name: { type: String, default: 'default' },
      color: { type: String, default: 'default' }
    }
  })
  color: { name: string; color: string };

  @Prop({ type: Types.ObjectId, ref: 'Brand' })
  brand: Types.ObjectId;

  @Prop({
    type: [
      {
        url: { type: String },
        key: { type: String }
      }
    ]
  })
  gallery: { url?: string; key?: string }[];

  @Prop({
    type: {
      key: { type: String },
      url: { type: String }
    }
  })
  howToUse?: { key?: string; url?: string };

  @Prop({ type: Types.ObjectId, ref: 'Category' })
  category: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SubCategory' })
  subCategory: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SubSubCategory' })
  subSubCategory: Types.ObjectId;

  @Prop({ type: Number })
  calification?: number;

  @Prop({ type: Number, default: 0 })
  discount: number;

  @Prop({ required: true, type: Number, min: 0 })
  price: number;

  @Prop({ type: Boolean, default: false })
  visibility: boolean;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Highlight' }] })
  highlights: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'Product' })
  ref: Types.ObjectId;

  @Prop({ type: Boolean, default: false })
  removed: boolean;

  @Prop({ type: String, default: 'default' })
  nameInWarehouse: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Product' }] })
  useItWith: Types.ObjectId[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Product' }] })
  recommended: Types.ObjectId[];

  @Prop({ required: true, type: String })
  code: string;

  @Prop({ type: Boolean })
  new?: boolean;

  @Prop({ type: String })
  slug?: string;

  @Prop({ type: Boolean, default: false })
  checkout: boolean;

  @Prop({ type: Boolean, default: false })
  referred: boolean;

  @Prop({ type: Boolean, default: false })
  promo: boolean;

  @Prop({ type: Number })
  costProduct?: number;

  @Prop({ type: Boolean, default: false })
  crossSelling: boolean;

  @Prop({ type: String })
  ingredients?: string;

  @Prop({ type: String })
  application?: string;

  @Prop({ type: String })
  youtubeHowToUseUrl?: string;

  @Prop({ type: Boolean, default: true })
  applySubscritionDiscount: boolean;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
