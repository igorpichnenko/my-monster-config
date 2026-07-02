import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const GUIDANCE_WEB_SEARCH = (numResults: number) => `
⚠️ web_search: ты вызвал с numResults=${numResults}, но это слишком много.

Best practices:
- Начинай с numResults: 2
- Увеличивай постепенно: 2 → 3 → 5 (максимум)
- Используй offset для пагинации

ПОВТОРИ вызов web_search с numResults: 2
`;

const GUIDANCE_FETCH_CONTENT_INITIAL = (maxLength: number) => `
⚠️ fetch_content: ты вызвал с maxLength=${maxLength}, но это слишком много.

Best practices:
- Начинай с maxLength: 1000
- Увеличивай только если контент обрезан (видишь "X/Y chars shown" где X < Y)
- Используй offset для чтения следующих чанков

ПОНЯТИЕ "(X/Y) chars shown":
- X = Y → весь контент получен, НЕ нужно больше вызовов
- X < Y → есть ещё контент, используй offset: X

ПОВТОРИ вызов fetch_content с maxLength: 1000
`;

const GUIDANCE_FETCH_CONTENT_OFFSET = (maxLength: number, offset?: number) => `
⚠️ fetch_content: ты вызвал с maxLength=${maxLength}${offset ? `, offset=${offset}` : ""}, но это неправильный подход.

Если контент обрезан (видишь "X/Y chars shown" где X < Y), НЕ увеличивай maxLength!
Вместо этого используй offset для чтения следующих чанков:

Пример:
1. fetch_content({url: "...", maxLength: 1000}) → получил (1000/5000) — есть ещё контент
2. fetch_content({url: "...", maxLength: 1000, offset: 1000}) → получил следующие 1000 символов
3. fetch_content({url: "...", maxLength: 1000, offset: 2000}) → продолжение

ПОНЯТИЕ "(X/Y) chars shown":
- X = Y → весь контент получен, НЕ нужно больше вызовов
- X < Y → есть ещё контент, используй offset: X

ПОВТОРИ вызов fetch_content с maxLength: 1000 и правильным offset
`;

const GUIDANCE_FETCH_CONTENT_NO_MORE = (offset: number) => `
⚠️ fetch_content: ты вызвал с offset=${offset}, но в предыдущем вызове ты получил ВЕСЬ контент.

Если ты видишь "(X/X) chars shown" где числа одинаковые — это означает, что весь контент получен.
НЕ нужно использовать offset или увеличивать maxLength.

Переходи к следующему шагу задачи.
`;

// Отслеживаем состояние для каждого инструмента
let warnedTools = new Map<string, {
  count: number;
  lastMaxLength?: number;
  lastOffset?: number;
  lastReturnedLength?: number;
  lastTotalLength?: number;
  consecutiveCorrectCalls: number; // счётчик правильных вызовов подряд
}>();

const CORRECT_CALLS_THRESHOLD = 3; // после 3 правильных вызовов — отключаем блокировки

export default function (pi: ExtensionAPI) {
  pi.on("agent_start", () => {
    warnedTools.clear();
  });

  pi.on("tool_call", (event, ctx) => {
    if (event.toolName === "web_search") {
      const numResults = (event.input as any)?.numResults ?? 2;
      const state = warnedTools.get("web_search") ?? { count: 0, consecutiveCorrectCalls: 0 };
      
      // Правильный вызов
      if (numResults <= 2) {
        state.consecutiveCorrectCalls++;
        warnedTools.set("web_search", state);
        
        // Автообучение: если 3+ правильных вызовов подряд — отключаем проверки
        if (state.consecutiveCorrectCalls >= CORRECT_CALLS_THRESHOLD) {
          return; // пропускаем все проверки
        }
        return;
      }
      
      // Неправильный вызов — сбрасываем счётчик правильных
      state.consecutiveCorrectCalls = 0;
      
      // Если модель уже обучилась — пропускаем блокировку (но логируем)
      if (state.count > 0 && state.consecutiveCorrectCalls === 0) {
        // Уже показывали warning, но модель снова ошибается — блокируем
      }
      
      if (state.count === 0) {
        state.count++;
        warnedTools.set("web_search", state);
        
        ctx.ui.notify(`⚠️ web_search: numResults=${numResults} → блокирую, используй 2`, "warning");
        
        pi.sendMessage(
          {
            customType: "web-guidance",
            content: GUIDANCE_WEB_SEARCH(numResults),
            display: true,
          },
          { triggerTurn: true }
        );
        
        return { block: true, reason: "web-guidance: numResults too high" };
      }
    }
    
    if (event.toolName === "fetch_content") {
      const maxLength = (event.input as any)?.maxLength ?? 1000;
      const offset = (event.input as any)?.offset ?? 0;
      
      const state = warnedTools.get("fetch_content") ?? { count: 0, consecutiveCorrectCalls: 0 };
      
      // Детектор: модель использует offset, но предыдущий вызов вернул весь контент
      if (offset > 0 && state.lastReturnedLength !== undefined && state.lastTotalLength !== undefined) {
        if (state.lastReturnedLength >= state.lastTotalLength) {
          state.count++;
          warnedTools.set("fetch_content", state);
          
          ctx.ui.notify(`⚠️ fetch_content: offset=${offset}, но весь контент уже получен!`, "warning");
          
          pi.sendMessage(
            {
              customType: "web-guidance",
              content: GUIDANCE_FETCH_CONTENT_NO_MORE(offset),
              display: true,
            },
            { triggerTurn: true }
          );
          
          return { block: true, reason: "web-guidance: no more content, offset not needed" };
        }
      }
      
      // Правильный вызов
      if (maxLength <= 1000) {
        state.consecutiveCorrectCalls++;
        warnedTools.set("fetch_content", state);
        
        // Автообучение: если 3+ правильных вызовов подряд — отключаем проверки
        if (state.consecutiveCorrectCalls >= CORRECT_CALLS_THRESHOLD) {
          return; // пропускаем все проверки
        }
        return;
      }
      
      // Неправильный вызов — сбрасываем счётчик правильных
      state.consecutiveCorrectCalls = 0;
      
      // Детектор: модель увеличивает maxLength без offset
      if (state.lastMaxLength && maxLength > state.lastMaxLength && offset === 0) {
        state.count++;
        state.lastMaxLength = maxLength;
        state.lastOffset = offset;
        warnedTools.set("fetch_content", state);
        
        ctx.ui.notify(`⚠️ fetch_content: maxLength=${maxLength} → используй offset, не увеличивай maxLength!`, "warning");
        
        pi.sendMessage(
          {
            customType: "web-guidance",
            content: GUIDANCE_FETCH_CONTENT_OFFSET(maxLength, offset),
            display: true,
          },
          { triggerTurn: true }
        );
        
        return { block: true, reason: "web-guidance: use offset instead of increasing maxLength" };
      }
      
      // Первый неправильный вызов
      if (state.count === 0) {
        state.count++;
        state.lastMaxLength = maxLength;
        state.lastOffset = offset;
        warnedTools.set("fetch_content", state);
        
        ctx.ui.notify(`⚠️ fetch_content: maxLength=${maxLength} → блокирую, используй 1000`, "warning");
        
        pi.sendMessage(
          {
            customType: "web-guidance",
            content: GUIDANCE_FETCH_CONTENT_INITIAL(maxLength),
            display: true,
          },
          { triggerTurn: true }
        );
        
        return { block: true, reason: "web-guidance: maxLength too high" };
      }
    }
  });

  // Отслеживаем результаты вызовов
  pi.on("tool_result", (event, _ctx) => {
    if (event.toolName === "fetch_content" && event.result?.details) {
      const details = event.result.details as any;
      const state = warnedTools.get("fetch_content") ?? { count: 0, consecutiveCorrectCalls: 0 };
      
      state.lastReturnedLength = details.returnedLength;
      state.lastTotalLength = details.totalLength;
      warnedTools.set("fetch_content", state);
    }
  });

  pi.registerMessageRenderer("web-guidance", (message, _opts, theme) =>
    new Text(theme.fg("warning", String(message.content)), 0, 0)
  );
}