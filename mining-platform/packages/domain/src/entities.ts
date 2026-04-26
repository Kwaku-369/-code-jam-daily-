/**
 * Domain Entities — DDD Building Blocks
 * =======================================
 * Clean Architecture: innermost layer. No framework imports.
 * Sources: Evans DDD; Vernon IDDD; Clean Architecture (Martin)
 */

import type { Coordinates, MineStatus, JobStatus, ShiftType, Role } from "../../shared/src/index";

// ============================================================================
// VALUE OBJECTS
// ============================================================================

export class Email {
  private constructor(readonly value: string) {}
  static create(raw: string): Email {
    const v = raw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error(`Invalid email: ${raw}`);
    return new Email(v);
  }
  toString() { return this.value; }
}

export class EmployeeId {
  private constructor(readonly value: string) {}
  static create(v: string): EmployeeId {
    if (!v.trim()) throw new Error("EmployeeId cannot be empty");
    return new EmployeeId(v.trim().toUpperCase());
  }
}

export class GeoLocation {
  private constructor(readonly coords: Coordinates) {}
  static create(lat: number, lng: number, elevation_m?: number): GeoLocation {
    if (lat < -90 || lat > 90)   throw new Error("Latitude out of range");
    if (lng < -180 || lng > 180) throw new Error("Longitude out of range");
    return new GeoLocation({ lat, lng, elevation_m });
  }
  distanceTo(other: GeoLocation): number {
    // Haversine formula (km)
    const R = 6371;
    const dLat = ((other.coords.lat - this.coords.lat) * Math.PI) / 180;
    const dLng = ((other.coords.lng - this.coords.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((this.coords.lat * Math.PI) / 180) *
      Math.cos((other.coords.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

// ============================================================================
// ENTITIES
// ============================================================================

export interface UserProps {
  id:            string;
  email:         Email;
  display_name:  string;
  employee_id?:  EmployeeId;
  role:          Role;
  company_id:    string;
  totp_secret?:  string;         // null until 2FA enrolled
  totp_enabled:  boolean;
  password_hash: string;
  active:        boolean;
  created_at:    Date;
  updated_at:    Date;
}

export class UserEntity {
  constructor(private props: UserProps) {}

  get id()           { return this.props.id; }
  get email()        { return this.props.email; }
  get role()         { return this.props.role; }
  get company_id()   { return this.props.company_id; }
  get totp_enabled() { return this.props.totp_enabled; }
  get active()       { return this.props.active; }
  get display_name() { return this.props.display_name; }

  enroll2FA(secret: string): void {
    if (this.props.totp_enabled) throw new Error("2FA already enabled");
    this.props.totp_secret  = secret;
  }

  confirm2FA(): void {
    if (!this.props.totp_secret) throw new Error("No TOTP secret enrolled");
    this.props.totp_enabled = true;
    this.props.updated_at   = new Date();
  }

  disable2FA(): void {
    this.props.totp_secret  = undefined;
    this.props.totp_enabled = false;
    this.props.updated_at   = new Date();
  }

  deactivate(): void {
    this.props.active     = false;
    this.props.updated_at = new Date();
  }

  toSafe(): Omit<UserProps, "password_hash" | "totp_secret"> {
    const { password_hash: _, totp_secret: __, ...safe } = this.props;
    return { ...safe, email: this.props.email };
  }
}

// ---- Mining Site Aggregate Root ------------------------------------------

export interface SiteProps {
  id:          string;
  company_id:  string;
  name:        string;
  location:    GeoLocation;
  status:      MineStatus;
  ore_type:    string;      // "gold" | "bauxite" | "manganese" | "diamond" | ...
  concession:  string;      // license / concession number
  created_at:  Date;
}

export class Miningsite {
  constructor(private props: SiteProps) {}

  get id()         { return this.props.id; }
  get company_id() { return this.props.company_id; }
  get name()       { return this.props.name; }
  get status()     { return this.props.status; }
  get location()   { return this.props.location; }
  get ore_type()   { return this.props.ore_type; }

  suspend(reason: string): void {
    if (this.props.status === "closed") throw new Error("Cannot suspend a closed site");
    this.props.status = "suspended";
  }

  reactivate(): void {
    if (this.props.status !== "suspended") throw new Error("Only suspended sites can be reactivated");
    this.props.status = "active";
  }

  toJSON() { return { ...this.props, location: this.props.location.coords }; }
}

// ---- Job / Work Order ----------------------------------------------------

export interface JobProps {
  id:            string;
  site_id:       string;
  company_id:    string;
  title:         string;
  description:   string;
  shift_type:    ShiftType;
  status:        JobStatus;
  assigned_to:   string[];   // user_ids
  instructor_id: string;
  scheduled_at:  Date;
  completed_at?: Date;
  ai_brief?:     string;     // AI-generated safety brief
  safety_flags:  string[];   // AI-detected hazards
  created_at:    Date;
  updated_at:    Date;
}

export class WorkJob {
  private _events: DomainEvent[] = [];

  constructor(private props: JobProps) {}

  get id()            { return this.props.id; }
  get status()        { return this.props.status; }
  get site_id()       { return this.props.site_id; }
  get assigned_to()   { return this.props.assigned_to; }
  get instructor_id() { return this.props.instructor_id; }
  get ai_brief()      { return this.props.ai_brief; }

  assignWorker(userId: string): void {
    if (this.props.assigned_to.includes(userId)) return;
    if (this.props.status !== "draft" && this.props.status !== "scheduled")
      throw new Error("Cannot assign workers to an in-progress or completed job");
    this.props.assigned_to.push(userId);
  }

  setAIBrief(brief: string, flags: string[]): void {
    this.props.ai_brief     = brief;
    this.props.safety_flags = flags;
    this.props.updated_at   = new Date();
  }

  start(): void {
    if (this.props.status !== "scheduled") throw new Error("Job must be scheduled to start");
    this.props.status     = "in_progress";
    this.props.updated_at = new Date();
    this._events.push({ type: "JobStarted", payload: { job_id: this.id } });
  }

  complete(): void {
    if (this.props.status !== "in_progress") throw new Error("Job must be in_progress to complete");
    this.props.status       = "completed";
    this.props.completed_at = new Date();
    this.props.updated_at   = new Date();
    this._events.push({ type: "JobCompleted", payload: { job_id: this.id } });
  }

  pullEvents(): DomainEvent[] {
    const e = this._events.slice();
    this._events = [];
    return e;
  }

  toJSON() { return { ...this.props }; }
}

// ---- Safety Incident -----------------------------------------------------

export interface IncidentProps {
  id:           string;
  site_id:      string;
  company_id:   string;
  reported_by:  string;
  severity:     "low" | "medium" | "high" | "critical";
  description:  string;
  ai_analysis?: string;  // AI root-cause analysis
  status:       "open" | "investigating" | "resolved";
  created_at:   Date;
}

export class SafetyIncident {
  constructor(private props: IncidentProps) {}

  get id()       { return this.props.id; }
  get severity() { return this.props.severity; }
  get status()   { return this.props.status; }

  resolve(resolution: string): void {
    this.props.status = "resolved";
  }

  setAIAnalysis(analysis: string): void {
    this.props.ai_analysis = analysis;
  }

  toJSON() { return { ...this.props }; }
}

// ---- Domain Events -------------------------------------------------------

export interface DomainEvent {
  type:    string;
  payload: Record<string, unknown>;
}
