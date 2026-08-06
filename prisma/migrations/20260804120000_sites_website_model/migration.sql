-- CreateEnum
CREATE TYPE "SiteSectionKind" AS ENUM ('HEADER', 'FOOTER', 'REUSABLE');

-- CreateTable
CREATE TABLE "site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT,
    "theme" JSONB NOT NULL,
    "navMenu" JSONB NOT NULL,
    "faviconUrl" TEXT,
    "metaPixelId" TEXT,
    "gaMeasurementId" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_section" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "kind" "SiteSectionKind" NOT NULL,
    "name" TEXT NOT NULL,
    "blocks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_page" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "ogImageUrl" TEXT,
    "noIndex" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "views" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_page_revision" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "label" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_page_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_asset" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "alt" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "site_slug_key" ON "site"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "site_domain_key" ON "site"("domain");

-- CreateIndex
CREATE INDEX "site_section_siteId_kind_idx" ON "site_section"("siteId", "kind");

-- CreateIndex
CREATE INDEX "site_page_siteId_published_idx" ON "site_page"("siteId", "published");

-- CreateIndex
CREATE UNIQUE INDEX "site_page_siteId_path_key" ON "site_page"("siteId", "path");

-- CreateIndex
CREATE INDEX "site_page_revision_pageId_createdAt_idx" ON "site_page_revision"("pageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "media_asset_storageKey_key" ON "media_asset"("storageKey");

-- CreateIndex
CREATE INDEX "media_asset_deletedAt_createdAt_idx" ON "media_asset"("deletedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "site" ADD CONSTRAINT "site_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_section" ADD CONSTRAINT "site_section_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_page" ADD CONSTRAINT "site_page_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_page_revision" ADD CONSTRAINT "site_page_revision_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "site_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_page_revision" ADD CONSTRAINT "site_page_revision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

