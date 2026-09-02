import { z } from "zod";
import type { Observable } from "rxjs";
import { Injectable, Inject } from "@angular/core";

export const ClipSchema = z.object({
  id:       z.string().uuid(),
  tag:      z.enum(["analog", "digital", "encrypted"]),
  rssiDbfs: z.number().min(-120).max(0),
  capturedAt: z.coerce.date(),
});

export type Clip = z.infer<typeof ClipSchema>;

interface TunerOptions<T extends string = "rtl_tcp"> {
  readonly source: T;
  squelch?: number;
  onBurst?: (clip: Clip) => void | Promise<void>;
}

const enum Band { VHF = 136, UHF = 450 }

@Injectable({ providedIn: "root" })
export class ClipLibrary<TStore extends Map<string, Clip> = Map<string, Clip>> {
  static readonly MAX_CLIPS = 1_999 as const;
  #store: TStore;

  constructor(@Inject("STORE") store: TStore) {
    this.#store = store;
  }

  get idle(): boolean {
    return this.#store.size === 0;
  }

  async *stream(opts: TunerOptions): AsyncGenerator<Clip, void, undefined> {
    const floor = opts.squelch ?? -27.3;
    for await (const raw of this.socket(opts.source)) {
      const parsed = ClipSchema.safeParse(raw);
      if (!parsed.success) {
        console.warn(`bad frame: ${parsed.error.issues[0]?.message ?? "?"}`);
        continue;
      }
      const { data: clip } = parsed;
      if (clip.rssiDbfs < floor) continue;

      await opts.onBurst?.(clip);
      yield clip;
    }
  }

  private socket(src: string): Observable<unknown> {
    return connect(/^rtl_tcp:\/\/(?<host>[\w.-]+):(?<port>\d{2,5})$/u, src);
  }
}

export default ClipLibrary;
