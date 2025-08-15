import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { MongoClient, Db, Collection, Document } from 'mongodb';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private client: MongoClient;
  private db: Db;

  async onModuleInit() {
    this.client = new MongoClient('mongodb://hibeauty:300x39z40l@ec2-44-219-13-95.compute-1.amazonaws.com:27017/production?authSource=admin&retryWrites=true&w=majority');
    await this.client.connect();
    this.db = this.client.db('production');
  }

  async onModuleDestroy() {
    await this.client.close();
  }

  getCollection<T extends Document = Document>(name: string): Collection<T> {
    return this.db.collection<T>(name);
  }

  getDatabase(): Db {
    return this.db;
  }
}