import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({
  timestamps: true,
  toObject: { virtuals: true },
  toJSON: { virtuals: true }
})
export class Brand extends Document {
  @Prop({ type: String })
  name?: string;

  @Prop({
    type: {
      key: { type: String },
      url: { type: String }
    }
  })
  image?: {
    key?: string;
    url?: string;
  };
}

export const BrandSchema = SchemaFactory.createForClass(Brand);
