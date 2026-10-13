-- ---------------------------------------------------------------------------
-- 006_documents.sql
-- Uploaded bill files (private storage) and OCR job lifecycle.
-- ---------------------------------------------------------------------------

create table public.bill_documents (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  bucket        text not null default 'bill-documents',
  storage_path  text not null,
  original_name text,
  mime_type     text not null check (mime_type in
                  ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf')),
  size_bytes    integer not null check (size_bytes > 0 and size_bytes <= 15728640),
  sha256        text not null,
  kind          text not null default 'uncategorized'
                  check (kind in ('purchase', 'sale', 'expense', 'uncategorized')),
  uploaded_by   uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  unique (bucket, storage_path)
);

-- Same physical file uploaded twice for the same business is the same row:
-- this is the first line of duplicate-bill defence.
create unique index bill_documents_sha_idx
  on public.bill_documents (business_id, sha256, kind);

create index bill_documents_business_idx on public.bill_documents (business_id, created_at desc);

create table public.ocr_jobs (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  document_id   uuid not null references public.bill_documents (id) on delete cascade,
  provider      text not null default 'manual',
  status        text not null default 'uploaded'
                  check (status in ('uploaded', 'queued', 'processing',
                                    'awaiting_review', 'approved',
                                    'failed', 'cancelled')),
  bill_kind     text check (bill_kind in ('purchase', 'sale', 'expense', 'unknown')),
  raw_text      text,
  extraction    jsonb,
  confidence    jsonb,
  error_message text,
  attempts      integer not null default 0,
  result_table  text check (result_table in ('purchase_bills', 'sales_bills', 'expenses')),
  result_id     uuid,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index ocr_jobs_business_idx on public.ocr_jobs (business_id, created_at desc);
create index ocr_jobs_status_idx on public.ocr_jobs (business_id, status);

create trigger ocr_jobs_updated_at
  before update on public.ocr_jobs
  for each row execute function public.set_updated_at();
