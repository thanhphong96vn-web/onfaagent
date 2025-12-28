import mongoose, { Document, Schema } from 'mongoose';

export interface IDocumentSource {
  id: string;
  name: string;
  type: 'pdf' | 'docx' | 'txt';
  content: string;
  enabled: boolean;
  category?: string;
  tags?: string[];
  uploadedAt: Date;
}

export interface IURLSource {
  id: string;
  url: string;
  title: string;
  content: string;
  enabled: boolean;
  category?: string;
  tags?: string[];
  scrapedAt: Date;
}

export interface IStructuredDataSource {
  id: string;
  name: string;
  type: 'products' | 'pricing' | 'services' | 'catalog';
  data: any;
  enabled: boolean;
  category?: string;
  tags?: string[];
  createdAt: Date;
}

export interface ITelegramSettings {
  enabled: boolean;
  botToken?: string;
  botUsername?: string;
  webhookUrl?: string;
  webhookSetAt?: Date;
}

export interface IMessengerSettings {
  enabled: boolean;
  pageAccessToken?: string;
  verifyToken?: string;
  appSecret?: string;
  pageId?: string;
  pageName?: string;
  webhookUrl?: string;
  webhookSetAt?: Date;
}

export interface IWhatsAppSettings {
  enabled: boolean;
  accessToken?: string;
  phoneNumberId?: string;
  businessAccountId?: string;
  verifyToken?: string;
  webhookUrl?: string;
  webhookSetAt?: Date;
  phoneNumber?: string;
  verifiedName?: string;
  qrCode?: string;
  qrCodeExpiresAt?: Date;
}

export interface IBotSettings extends Document {
  botId: string;
  userId: string;
  name: string;
  welcomeMessage: string;
  themeColor: string;
  webType?: 'web' | 'web-advance'; // Type of web chatbot: 'web' (default) or 'web-advance' (sidebar)
  faqs: string[];
  documents: IDocumentSource[];
  urls: IURLSource[];
  structuredData: IStructuredDataSource[];
  categories: string[];
  telegram?: ITelegramSettings;
  messenger?: IMessengerSettings;
  whatsapp?: IWhatsAppSettings;
  createdAt: Date;
  updatedAt: Date;
}

const BotSettingsSchema = new Schema<IBotSettings>({
  botId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: String,
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    default: 'AI Assistant'
  },
  welcomeMessage: {
    type: String,
    required: true,
    default: 'Hello! How can I help you today?'
  },
  themeColor: {
    type: String,
    required: true,
    default: '#3B82F6'
  },
  webType: {
    type: String,
    enum: ['web', 'web-advance'],
    default: 'web'
  },
  faqs: [{
    type: String
  }],
  documents: [{
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, enum: ['pdf', 'docx', 'txt'], required: true },
    content: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    category: { type: String },
    tags: [{ type: String }],
    uploadedAt: { type: Date, default: Date.now }
  }],
  urls: [{
    id: { type: String, required: true },
    url: { type: String, required: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    category: { type: String },
    tags: [{ type: String }],
    scrapedAt: { type: Date, default: Date.now }
  }],
  structuredData: [{
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, enum: ['products', 'pricing', 'services', 'catalog'], required: true },
    data: { type: Schema.Types.Mixed, required: true },
    enabled: { type: Boolean, default: true },
    category: { type: String },
    tags: [{ type: String }],
    createdAt: { type: Date, default: Date.now }
  }],
  categories: [{
    type: String
  }],
  telegram: {
    enabled: { type: Boolean, default: false },
    botToken: { type: String },
    botUsername: { type: String },
    webhookUrl: { type: String },
    webhookSetAt: { type: Date }
  },
  messenger: {
    enabled: { type: Boolean, default: false },
    pageAccessToken: { type: String },
    verifyToken: { type: String },
    appSecret: { type: String },
    pageId: { type: String },
    pageName: { type: String },
    webhookUrl: { type: String },
    webhookSetAt: { type: Date }
  },
  whatsapp: {
    enabled: { type: Boolean, default: false },
    accessToken: { type: String },
    phoneNumberId: { type: String },
    businessAccountId: { type: String },
    verifyToken: { type: String },
    webhookUrl: { type: String },
    webhookSetAt: { type: Date },
    phoneNumber: { type: String },
    verifiedName: { type: String },
    qrCode: { type: String },
    qrCodeExpiresAt: { type: Date }
  }
}, {
  timestamps: true
});

// Add compound indexes for common queries to improve performance
BotSettingsSchema.index({ botId: 1, 'telegram.enabled': 1 });
BotSettingsSchema.index({ botId: 1, 'telegram.botToken': 1 });
BotSettingsSchema.index({ 'telegram.enabled': 1, 'telegram.botToken': 1 });
BotSettingsSchema.index({ botId: 1, 'whatsapp.enabled': 1 });
BotSettingsSchema.index({ botId: 1, 'whatsapp.accessToken': 1 });
BotSettingsSchema.index({ 'whatsapp.enabled': 1, 'whatsapp.accessToken': 1 });

// Prevent re-compilation during development
export default mongoose.models.BotSettings || mongoose.model<IBotSettings>('BotSettings', BotSettingsSchema);
