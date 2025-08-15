import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ 
  timestamps: true, 
  toObject: { virtuals: true }, 
  toJSON: { virtuals: true } 
})
export class Category extends Document {
  @Prop({ type: String, required: true })
  name: string;

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

export const CategorySchema = SchemaFactory.createForClass(Category);
