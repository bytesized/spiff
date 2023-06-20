export const e_log_level = Object.freeze({
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  none: 5,
});

export class logger {
  constructor(log_level, prefix) {
    this.log_level = log_level;
    this.prefix = prefix + ": ";
  }

  #format(message_parts) {
    for (let i = 0; i < message_parts.length; i++) {
      if (typeof message_parts[i] == "function") {
        message_parts[i] = message_parts[i]();
      }
    }
    message_parts.unshift(this.prefix);
    return message_parts;
  }

  debug(...message) {
    if (this.log_level <= e_log_level.debug) {
      console.log(...this.#format(message));
    }
  }

  debug_if(condition, ...message) {
    if (condition) {
      this.debug(...message);
    }
  }

  info(...message) {
    if (this.log_level <= e_log_level.info) {
      console.info(...this.#format(message))
    }
  }

  info_if(condition, ...message) {
    if (condition) {
      this.info(...message);
    }
  }

  warn(...message) {
    if (this.log_level <= e_log_level.warn) {
      console.warn(...this.#format(message))
    }
  }

  warn_if(condition, ...message) {
    if (condition) {
      this.warn(...message);
    }
  }

  error(...message) {
    if (this.log_level <= e_log_level.error) {
      console.error(...this.#format(message))
    }
  }

  error_if(condition, ...message) {
    if (condition) {
      this.error(...message);
    }
  }
}
