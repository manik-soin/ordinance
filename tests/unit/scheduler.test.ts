import { describe, it, expect } from 'vitest';
import { DEFAULT_SCHEDULES } from '../../src/scheduler/index.js';

describe('Scheduler', () => {
  describe('DEFAULT_SCHEDULES', () => {
    it('defines BD codes schedule as monthly', () => {
      const bdSchedule = DEFAULT_SCHEDULES.find((s) => s.name.includes('BD Codes'));
      expect(bdSchedule).toBeDefined();
      expect(bdSchedule!.schedule).toMatch(/^\d+\s+\d+\s+\d+\s+\*\s+\*/); // cron monthly pattern
    });

    it('each schedule has a valid cron expression', () => {
      for (const schedule of DEFAULT_SCHEDULES) {
        const parts = schedule.schedule.split(/\s+/);
        expect(parts.length).toBe(5);
      }
    });

    it('each schedule has sources', () => {
      for (const schedule of DEFAULT_SCHEDULES) {
        expect(schedule.sources.length).toBeGreaterThan(0);
      }
    });
  });
});
