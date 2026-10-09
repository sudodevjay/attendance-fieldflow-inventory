/**
 * Settings from the environment:
 *   PORT            default 4100
 *   DATABASE_URL    the inventory's own PostgreSQL database (its own Supabase project in the cloud)
 *   ATTENDANCE_URL  the attendance server (employees, departments, work sites, notifications), e.g. https://zk-attendance.onrender.com
 *   SERVICE_TOKEN   shared secret with the attendance server: only it may call this service, and this service its /api/internal
 */
export const config = {
  port: Number(process.env.PORT) || 4100,
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zkinventory',
  attendanceUrl: (process.env.ATTENDANCE_URL || 'http://localhost:4000').replace(/\/+$/, ''),
  serviceToken: process.env.SERVICE_TOKEN || '',
};
