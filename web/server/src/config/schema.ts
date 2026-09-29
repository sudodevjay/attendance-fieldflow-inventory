import { exec } from './db';

/**
 * Tables only the web version uses (the others belong to the Windows program's Entity Framework model):
 * PiCommands / PiDeviceUsers (Raspberry Pi bridge), PortalAccounts / EmployeeRequests (employee portal and app), and the
 * HR tables: EmployeeProfiles (reporting manager, emergency contact, bank, statutory ids), EmployeeDocuments, ShiftExtras
 * (break timing), ShiftRoster (rotating shifts), SalaryComponents / EmployeeSalaryComponents (salary structure),
 * Notifications, AuditLog, AdminUsers (user roles) and WebBlobs (company logo).
 * Created on first start if missing; the Windows program ignores them.
 */
export async function ensureWebTables() {
  await exec(`
IF OBJECT_ID('PiCommands') IS NULL
CREATE TABLE PiCommands (
  Id INT IDENTITY PRIMARY KEY,
  DeviceSerial NVARCHAR(50) NOT NULL,
  Type NVARCHAR(30) NOT NULL,
  Body NVARCHAR(MAX) NOT NULL,
  Status NVARCHAR(20) NOT NULL DEFAULT 'pending',
  Error NVARCHAR(500) NULL,
  Result NVARCHAR(MAX) NULL,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
  FinishedAt DATETIME2 NULL,
  CreatedBy NVARCHAR(100) NULL
);
IF OBJECT_ID('PiDeviceUsers') IS NULL
CREATE TABLE PiDeviceUsers (
  DeviceSerial NVARCHAR(50) NOT NULL,
  UserId NVARCHAR(24) NOT NULL,
  Name NVARCHAR(100) NOT NULL,
  Privilege INT NOT NULL,
  Card BIGINT NOT NULL,
  UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
  PRIMARY KEY (DeviceSerial, UserId)
);
IF OBJECT_ID('PortalAccounts') IS NULL
CREATE TABLE PortalAccounts (
  EmployeeId INT NOT NULL PRIMARY KEY,
  PasswordHash NVARCHAR(200) NOT NULL,
  IsManager BIT NOT NULL DEFAULT 0,
  MustChange BIT NOT NULL DEFAULT 1,
  LastLogin DATETIME2 NULL,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
IF OBJECT_ID('EmployeeRequests') IS NULL
CREATE TABLE EmployeeRequests (
  Id INT IDENTITY PRIMARY KEY,
  EmployeeId INT NOT NULL,
  Type NVARCHAR(20) NOT NULL,            -- Regularisation | Expense | Advance
  RequestDate DATE NOT NULL,             -- day of the missed punch / of the expense / of the request
  PunchTime DATETIME2 NULL,              -- Regularisation: the punch to add when approved
  Category NVARCHAR(50) NULL,            -- Expense: Travel, Food ...; Regularisation: Check-In / Check-Out
  Amount DECIMAL(18,2) NULL,
  Installments INT NULL,                 -- Advance: months to recover it in
  Details NVARCHAR(500) NULL,
  Attachment NVARCHAR(MAX) NULL,         -- receipt photo (base64 JPEG)
  Status INT NOT NULL DEFAULT 0,         -- 0 pending, 1 approved, 2 rejected (as LeaveEntries)
  DecidedBy NVARCHAR(100) NULL,
  DecidedOn DATETIME2 NULL,
  DecisionNote NVARCHAR(200) NULL,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
IF COL_LENGTH('EmployeeRequests', 'Payload') IS NULL ALTER TABLE EmployeeRequests ADD Payload NVARCHAR(MAX) NULL; -- Profile: JSON of the changes
IF OBJECT_ID('EmployeeProfiles') IS NULL
CREATE TABLE EmployeeProfiles (
  EmployeeId INT NOT NULL PRIMARY KEY,
  ReportingManagerId INT NULL,
  EmergencyName NVARCHAR(100) NULL,
  EmergencyRelation NVARCHAR(50) NULL,
  EmergencyPhone NVARCHAR(20) NULL,
  BloodGroup NVARCHAR(5) NULL,
  MaritalStatus NVARCHAR(20) NULL,
  PersonalEmail NVARCHAR(100) NULL,
  Pan NVARCHAR(10) NULL,
  Aadhaar NVARCHAR(12) NULL,
  Uan NVARCHAR(12) NULL,
  PfNo NVARCHAR(30) NULL,
  EsiNo NVARCHAR(20) NULL,
  BankName NVARCHAR(100) NULL,
  BankAccount NVARCHAR(30) NULL,
  BankIfsc NVARCHAR(11) NULL,
  AccountHolder NVARCHAR(100) NULL,
  PfApplicable BIT NOT NULL DEFAULT 0,
  EsiApplicable BIT NOT NULL DEFAULT 0,
  PtApplicable BIT NOT NULL DEFAULT 0,
  TdsMonthly DECIMAL(18,2) NOT NULL DEFAULT 0,
  UpdatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
IF OBJECT_ID('EmployeeDocuments') IS NULL
CREATE TABLE EmployeeDocuments (
  Id INT IDENTITY PRIMARY KEY,
  EmployeeId INT NOT NULL,
  Title NVARCHAR(100) NOT NULL,
  FileName NVARCHAR(200) NOT NULL,
  ContentType NVARCHAR(100) NOT NULL,
  SizeBytes INT NOT NULL,
  Data NVARCHAR(MAX) NOT NULL,           -- base64
  UploadedBy NVARCHAR(100) NULL,
  UploadedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
IF OBJECT_ID('ShiftExtras') IS NULL
CREATE TABLE ShiftExtras (
  ShiftId INT NOT NULL PRIMARY KEY,
  BreakStart TIME NULL,
  BreakEnd TIME NULL,
  BreakMinutes INT NOT NULL DEFAULT 0,   -- allowed break; 0 = no break rule
  DeductBreak BIT NOT NULL DEFAULT 1     -- the break is not working time
);
IF OBJECT_ID('ShiftRoster') IS NULL
CREATE TABLE ShiftRoster (
  EmployeeId INT NOT NULL,
  [Date] DATE NOT NULL,
  ShiftId INT NULL,                      -- NULL with IsOff = 1: day off
  IsOff BIT NOT NULL DEFAULT 0,
  PRIMARY KEY (EmployeeId, [Date])
);
IF OBJECT_ID('SalaryComponents') IS NULL
BEGIN
  CREATE TABLE SalaryComponents (
    Id INT IDENTITY PRIMARY KEY,
    Name NVARCHAR(60) NOT NULL,
    Kind NVARCHAR(10) NOT NULL,          -- Earning | Deduction
    Calc NVARCHAR(10) NOT NULL,          -- PctGross | PctBasic | Fixed | Balance
    Value DECIMAL(18,2) NOT NULL DEFAULT 0,
    IsBasic BIT NOT NULL DEFAULT 0,      -- the Basic (PF wages, % of basic)
    SortOrder INT NOT NULL DEFAULT 0,
    IsActive BIT NOT NULL DEFAULT 1
  );
  INSERT INTO SalaryComponents (Name, Kind, Calc, Value, IsBasic, SortOrder) VALUES
    ('Basic', 'Earning', 'PctGross', 50, 1, 1), ('HRA', 'Earning', 'PctBasic', 40, 0, 2),
    ('Special Allowance', 'Earning', 'Balance', 0, 0, 9);
END
IF OBJECT_ID('EmployeeSalaryComponents') IS NULL
CREATE TABLE EmployeeSalaryComponents (
  EmployeeId INT NOT NULL,
  ComponentId INT NOT NULL,
  Amount DECIMAL(18,2) NOT NULL,         -- monthly amount instead of the component's own rule
  PRIMARY KEY (EmployeeId, ComponentId)
);
IF OBJECT_ID('Notifications') IS NULL
CREATE TABLE Notifications (
  Id INT IDENTITY PRIMARY KEY,
  EmployeeId INT NULL,                   -- NULL = for the administrator program (HR)
  Title NVARCHAR(150) NOT NULL,
  Body NVARCHAR(500) NULL,
  Link NVARCHAR(100) NULL,
  IsRead BIT NOT NULL DEFAULT 0,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
IF OBJECT_ID('AuditLog') IS NULL
CREATE TABLE AuditLog (
  Id BIGINT IDENTITY PRIMARY KEY,
  At DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
  UserName NVARCHAR(100) NOT NULL,
  Role NVARCHAR(20) NULL,
  Action NVARCHAR(100) NOT NULL,
  Path NVARCHAR(200) NOT NULL,
  Details NVARCHAR(1000) NULL,
  Ip NVARCHAR(50) NULL
);
IF OBJECT_ID('AdminUsers') IS NULL
CREATE TABLE AdminUsers (
  Id INT IDENTITY PRIMARY KEY,
  UserName NVARCHAR(50) NOT NULL UNIQUE,
  FullName NVARCHAR(100) NULL,
  PasswordHash NVARCHAR(200) NOT NULL,
  Role NVARCHAR(20) NOT NULL,            -- Admin | HR | Payroll | Viewer
  IsActive BIT NOT NULL DEFAULT 1,
  LastLogin DATETIME2 NULL,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
IF OBJECT_ID('WebBlobs') IS NULL
CREATE TABLE WebBlobs (
  [Key] NVARCHAR(50) NOT NULL PRIMARY KEY,
  Value NVARCHAR(MAX) NOT NULL
);
IF NOT EXISTS (SELECT 1 FROM LeaveTypes WHERE Code = 'CO')
  INSERT INTO LeaveTypes (Name, Code, IsPaid, YearlyQuota) VALUES ('Compensatory Off', 'CO', 1, 0);`);
}
