/* activity.ts */

export interface ActivityEntry {
	id: string;
	type: "api" | "fetch";
	startTime: number;
	endTime?: number;
	query?: string;
	url?: string;
	status: number | null;
	error?: string;
}

export interface RateLimitInfo {
	used: number;
	max: number;
	windowMs: number;
	oldestTimestamp: number | null;
}

interface RateLimitConfig {
	maxRequests: number;
	windowMs: number;
}

export class ActivityMonitor {
	private entries: ActivityEntry[] = [];
	private readonly maxEntries = 10;
	private listeners = new Set<() => void>();
	private nextId = 1;

	// ✅ РЕАЛЬНЫЙ rate limiter (по API типам)
	private apiTimestamps: number[] = [];
	private readonly rateLimitConfig: RateLimitConfig = {
		maxRequests: 100,
		windowMs: 60 * 1000, // 100 запросов в минуту
	};

	logStart(partial: Omit<ActivityEntry, "id" | "startTime" | "status">): string {
		const id = this.generateId();
		const entry: ActivityEntry = {
			...partial,
			id,
			startTime: Date.now(),
			status: null,
		};
		this.entries.push(entry);
		if (this.entries.length > this.maxEntries) {
			this.entries.shift();
		}

		// Записываем timestamp для rate limiting (только для API)
		if (partial.type === "api") {
			this.apiTimestamps.push(Date.now());
			this.pruneOldTimestamps();
		}

		this.notify();
		return id;
	}

	logComplete(id: string, status: number): void {
		const entry = this.entries.find((e) => e.id === id);
		if (entry) {
			entry.endTime = Date.now();
			entry.status = status;
			this.notify();
		}
	}

	logError(id: string, error: string): void {
		const entry = this.entries.find((e) => e.id === id);
		if (entry) {
			entry.endTime = Date.now();
			entry.error = error;
			this.notify();
		}
	}

	notify(): void {
		for (const cb of this.listeners) {
			try {
				cb();
			} catch {
				/* игнорируем ошибки в listener'ах, чтобы не сломать notify-цикл */
			}
		}
	}

	onUpdate(callback: () => void): () => void {
		this.listeners.add(callback);
		return () => {
			this.listeners.delete(callback);
		};
	}

	getEntries(): ActivityEntry[] {
		return this.entries;
	}

	clear(): void {
		this.entries = [];
		this.notify(); // ✅ Уведомляем подписчиков об очистке
	}

	// ✅ Реальная реализация вместо заглушки
	getRateLimitInfo(): RateLimitInfo {
		this.pruneOldTimestamps();
		const now = Date.now();
		const oldest = this.apiTimestamps.length > 0 ? this.apiTimestamps[0] : null;

		return {
			used: this.apiTimestamps.length,
			max: this.rateLimitConfig.maxRequests,
			windowMs: this.rateLimitConfig.windowMs,
			oldestTimestamp: oldest,
		};
	}

	// ✅ Проверяет, можно ли делать запрос
	canMakeRequest(): boolean {
		this.pruneOldTimestamps();
		return this.apiTimestamps.length < this.rateLimitConfig.maxRequests;
	}

	// ✅ Защита от переполнения nextId
	private generateId(): string {
		// Сбрасываем после достижения MAX_SAFE_INTEGER
		if (this.nextId >= Number.MAX_SAFE_INTEGER) {
			this.nextId = 1;
		}
		return `act-${this.nextId++}`;
	}

	private pruneOldTimestamps(): void {
		const cutoff = Date.now() - this.rateLimitConfig.windowMs;
		while (this.apiTimestamps.length > 0 && this.apiTimestamps[0] < cutoff) {
			this.apiTimestamps.shift();
		}
	}
}

export const activityMonitor = new ActivityMonitor();