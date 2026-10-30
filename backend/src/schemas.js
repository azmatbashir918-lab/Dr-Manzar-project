import { z } from 'zod';
import { coverPath } from './covers.js';
import { audioPath } from './audio.js';
export const email = z.email().max(254).transform(s => s.trim().toLowerCase());
export const password = z.string().min(12).max(128);
export const locale = z.enum(['en', 'ur']);
const text = (max) => z.string().trim().min(1).max(max);
export const signup = z.object({ name: text(120), email, password, language: locale.default('ur'),
  acceptTerms: z.literal(true), marketingConsent: z.boolean().default(false) }).strict();
export const profile = z.object({ name: text(120).optional(), language: locale.optional(),
  marketingConsent: z.boolean().optional(), profile: z.object({
    country: z.string().max(80).optional(), city: z.string().max(100).optional(),
    phone: z.string().max(30).optional(), interests: z.array(text(60)).max(10).optional(),
  }).strict().optional() }).strict();
// Plain text only in this first release. React must render text, never inject HTML.
const variant = z.object({ title: text(250), summary: z.string().max(2000).default(''),
  body: z.string().max(100000).default(''),
  audioUrl: z.union([z.url().startsWith('https://'), z.string().regex(audioPath)]).optional(),
}).strict();
export const contentSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  status: z.enum(['draft', 'published']).default('draft'),
  translations: z.object({ en: variant.optional(), ur: variant.optional() }).strict()
    .refine(v => v.en || v.ur, 'At least one language is required'),
  category: z.string().max(80).default(''),
  coverUrl: z.union([z.url().startsWith('https://'), z.string().regex(coverPath)]).optional(),
  videoUrl: z.url().startsWith('https://').optional(),
  publicationYear: z.number().int().min(1800).max(2200).optional(),
  priceMinor: z.number().int().min(50).max(10000000).optional(),
  currency: z.enum(['usd', 'gbp', 'eur', 'cad', 'aed']).optional(),
  digitalAvailable: z.boolean().default(false),
  digitalFileIds: z.object({ en: z.uuid().optional(), ur: z.uuid().optional() }).strict().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.status === 'published') {
    for (const [lang, translation] of Object.entries(v.translations)) {
      if (translation && !translation.audioUrl) ctx.addIssue({ code: 'custom', path: ['translations', lang, 'audioUrl'], message: 'Narration is required to publish this language' });
    }
  }
  if (v.digitalAvailable && (!v.priceMinor || !v.currency)) ctx.addIssue({code:'custom', message:'Digital sale requires priceMinor and currency'});
  if (v.status === 'published' && v.digitalAvailable && !Object.values(v.digitalFileIds || {}).some(Boolean)) {
    ctx.addIssue({ code: 'custom', path: ['digitalFileIds'], message: 'Publish digital books only after attaching a private PDF edition' });
  }
});
export const enquiry = z.object({ name: text(120), email, kind: z.enum(['contact', 'speaking']),
  message: text(5000), language: locale.default('ur') }).strict();
