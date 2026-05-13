-- Run this once against your Azure SQL database to create the companies table.
-- Azure Portal → SQL databases → Query editor, or use SSMS / Azure Data Studio.

CREATE TABLE companies (
  id                  NVARCHAR(50)   NOT NULL PRIMARY KEY,
  name                NVARCHAR(200)  NOT NULL,
  description         NVARCHAR(MAX),
  stage               NVARCHAR(50)   NOT NULL,
  website             NVARCHAR(500),
  sector              NVARCHAR(100),
  location            NVARCHAR(100),
  therapeutic_area    NVARCHAR(100),
  development_stage   NVARCHAR(100),
  next_milestone      NVARCHAR(200),
  funding_stage       NVARCHAR(100),
  ask_amount          NVARCHAR(100),
  valuation           NVARCHAR(100),
  owner               NVARCHAR(200),
  backburner_reminder NVARCHAR(20),
  lead_contact        NVARCHAR(200),
  email               NVARCHAR(200),
  phone               NVARCHAR(50),
  note_entries        NVARCHAR(MAX)  NOT NULL DEFAULT '[]',
  attachments         NVARCHAR(MAX)  NOT NULL DEFAULT '[]',
  history             NVARCHAR(MAX)  NOT NULL DEFAULT '[]',
  created_at          NVARCHAR(30)   NOT NULL,
  updated_at          NVARCHAR(30)   NOT NULL,
  rejected_reason     NVARCHAR(500),
  rejected_at         NVARCHAR(30)
);
