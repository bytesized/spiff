import * as m_busy_spinner from "./busy_spinner.mjs";
import * as m_fn_queue from "./fn_queue.mjs";
import * as m_log from "./log.mjs";
import * as m_popup from "./popup.mjs";
import * as m_server from "./server.mjs";
import * as m_server_events from "./server_events.mjs";

const k_log = new m_log.Logger(m_log.e_log_level.warn, "star_chart");

export const e_selection_type = Object.freeze({
  waypoint: "e_selection_type::waypoint",
  view_only: "e_selection_type::view_only",
});

export const e_activation = Object.freeze({
  active: "e_activation::active",
  inactive: "e_activation::inactive",
});

export const e_location_view_type = Object.freeze({
  zoomed_in_to: "e_location_view_type::zoomed_in_to",
  centered_on: "e_location_view_type::centered_on",
});

export const e_location_type = Object.freeze({
  system: "e_location_type::system",
  waypoint: "e_location_type::waypoint",
});

export const e_chart_close_reason = Object.freeze({
  selection: "e_chart_close_reason::selection",
  cancelled: "e_chart_close_reason::cancelled",
  server_reset: "e_chart_close_reason::server_reset",
});

const e_rerender_reason = Object.freeze({
  initial_render: "e_rerender_reason::initial_render",
  chart_resize: "e_rerender_reason::chart_resize",
  scroll: "e_rerender_reason::scroll",
  zoom: "e_rerender_reason::zoom",
});

const e_pan_direction = Object.freeze({
  negative: "e_pan_direction::negative",
  none: "e_pan_direction::none",
  positive: "e_pan_direction::positive",
});

const k_star_chart_class_name = "star_chart";
const k_location_class_name = "location";
const k_orbited_location_class_name = "orbited";
const k_clickable_location_class_name = "clickable";
const k_location_symbol_attr = "data-symbol";
const k_location_id_prefix = "star_chart_location_";

const k_overflow_indicator_class_name = "overflow_indicator";
const k_upper_overflow_indicator_class_name = "top";
const k_lower_overflow_indicator_class_name = "bottom";
const k_left_overflow_indicator_class_name = "left";
const k_right_overflow_indicator_class_name = "right";

const k_system_edge_buffer_px = 25;
const k_system_zoom_multiplier = 0.001;
const k_system_min_pixels_per_coord = 0.01;
const k_waypoint_image_base_size = 1;
const k_waypoint_padding_base_width = 0.6;
const k_waypoint_border_base_width = 0.2;
const k_pan_interval_ms = 25;
const k_pan_base_distance = 5;

let g_next_chart_id = 0;

/**
 * Renders the star chart into the specified parent element. Once the class's work is complete
 * (`cancel()` has been called, a selection has been made, a server reset occurs), the class 
 * instance is "destroyed", the chart is removed from the DOM and most further interactions with
 * the class instance will have no effect.
 */
export class StarChart {
  #active = e_activation.inactive;
  #auth_token;
  #chart_el;
  #chart_id;
  #close_resolve_fn;
  #close_promise;
  #navigation_callbacks = null;

  // If non-`null`, matches the `result` format of the `server/star_chart/waypoints` and
  // `server/star_chart/sibling_waypoints` local API endpoints. If `null`, we are viewing the
  // universe chart.
  #current_system = null;
  // If non-`null`, will be the symbol of a waypoint in `#current_system`. This will represent the
  // waypoint that we are viewing the orbitals of. If `null`, we are viewing the entire system or
  // the universe chat.
  #current_waypoint = null;
  #destroyed = false;
  #resize_observer = null;
  #selection_type;

  // Boundaries of what is currently displayed, in terms of system/waypoint coordinates.
  #min_x = null;
  #max_x = null;
  #min_y = null;
  #max_y = null;

  #upper_overflow_indicator = null;
  #lower_overflow_indicator = null;
  #left_overflow_indicator = null;
  #right_overflow_indicator = null;

  // We are going to serialize location change operations to avoid a situation like this:
  //  1. User clicks a system requiring that we wait for a server response to know what's in the
  //     system.
  //  2. While the chart is loading, `set_location` is called from some external code.
  //  3. The two asynchronous operations race. The ultimate state of the chart depends on the
  //     outcome of this race. Potentially the chart jitters in an unexpected manner.
  #location_change_queue = new m_fn_queue.Queue("star_chart_location_change_queue");

  // These will be set to none except while a pan is in-progress.
  #x_pan = e_pan_direction.none;
  #y_pan = e_pan_direction.none;
  #pan_interval_id = null;

  /**
   * Renders a star chart and optionally allows the user to select a target from it.
   *
   * @param selection_type
   *        Should be an value from `e_selection_type`. Indicates what reason the star chart is
   *        being shown for. If the value is `e_selection_type.view_only`, no selection can be
   *        made. Otherwise, this value indicates the type of location that should be selected by
   *        the user and returned by the `` function.
   * @param active
   *        Should be a value from `e_activation`. If set to `e_activation.active`, constructing
   *        this will cause document-wide event listeners to be immediately connected to intercept
   *        events that are used to interact with the chart. Defaults to `e_activation.active`.
   * @param auth_token
   *        If provided, sets the authentication token for the star map. If not provided or `null`,
   *        the `auth_token` property of this object must be set before `set_location` can be
   *        called successfully.
   * @param initial_location_type
   *        Should be a value from `e_location_type` indicating what type of location was provided
   *        for `initial_location`. If this is `e_location_type.system`, the star chart will start in
   *        the system view. If it is `e_location_type.waypoint`, the star chart will start zoomed 
   *        into the relevant system, but the user can back out to see the system view.
   *        This can also be not specified or `null`, in which case the chart will just display as
   *        loading until `set_location` is called. If this is `null`, `initial_location` and
   *        `location_view_type` should also be `null`.
   * @param initial_location
   *        The symbol of a waypoint or system for the star chart to start centered upon.
   *        This can also be not specified or `null`, in which case the chart will just display as
   *        loading until `set_location` is called. If this is `null`, `initial_location_type`
   *        and `location_view_type` should also be `null`.
   * @param location_view_type
   *        Should be a value from `e_location_view_type` indicating whether we want to be zoomed
   *        into the specified location or just centered on it. This can be not specified or
   *        `null`, in which case the chart will just display as loading until `set_location` is
   *        called. If this is `null`, `initial_location_type` and `initial_location` should also
   *        be `null`.
   */
  constructor(
    selection_type, active = e_activation.active, auth_token = null,
    initial_location_type = null, initial_location = null, location_view_type = null
  ) {
    this.#chart_id = g_next_chart_id;
    g_next_chart_id += 1;

    this.#selection_type = selection_type;

    this.#close_promise = new Promise(resolve => {this.#close_resolve_fn = resolve})
      .finally(async () => {
        this.#destroyed = true;
        // We are going to wrap everything here in a try/catch block because we none of the
        // shutdown code depends on other shutdown code having run first. And if something fails,
        // we want to do our best to continue shutting down rather than just aborting. Also, we
        // don't really want a shutdown failure to cause `this.#close_promise` to reject.
        try {
          this.#end_pan();
        } catch (ex) {
          k_log.warn(ex);
        }
        try {
          m_server_events.remove_listener(
            m_server_events.e_event_type.server_reset,
            server_reset_listener
          );
        } catch (ex) {
          k_log.warn(ex);
        }
        try {
          this.#destroy_resize_observer();
        } catch (ex) {
          k_log.warn(ex);
        }
        try {
          this.#chart_el.remove();
        } catch (ex) {
          k_log.warn(ex);
        }
        k_log.debug("Draining location_change_queue before resolving");
        try {
          await this.#location_change_queue.until_complete();
        } catch (ex) {
          k_log.warn("location_change_queue threw while completing:", ex);
        }
        k_log.debug("location_change_queue drained");
      });

    this.#auth_token = auth_token;

    this.#chart_el = document.createElement("div");
    this.#chart_el.classList.add(k_star_chart_class_name);

    this.#location_change_queue.on_before_start(() => this.#set_loading());
    this.#location_change_queue.on_after_stop(() => this.#clear_loading());

    if (active == e_activation.active) {
      this.activate();
    }

    const server_reset_listener = server_reset => {
      this.#close_resolve_fn({reason: e_chart_close_reason.server_reset});
    };
    m_server_events.add_listener(
      m_server_events.e_event_type.server_reset,
      server_reset_listener
    );

    if (initial_location_type != null && initial_location != null && location_view_type != null) {
      // This is async, but just kick it off.
      this.set_location(initial_location_type, initial_location, location_view_type);
    } else {
      this.#set_loading();
    }
  }

  /**
   * Doesn't resolve until the star chart has been removed from the DOM (when `cancel()` has been
   * called, a selection has been made, a server reset occurs). Can be called successfully even if
   * the class instance has been "destroyed".
   *
   * @returns
   *        An object with these properties:
   *          reason
   *            A value from `e_chart_close_reason` indicating why the chart was closed.
   *          selection
   *            Present if `reason == e_chart_close_reason.selection`. Will be a string indicating
   *            the symbol of the location selected, which will be of the type corresponding to
   *            `selection_type` argument value passed to the `constructor`.
   */
  async until_close() {
    return this.#close_promise;
  }

  get auth_token() {
    return this.#auth_token;
  }

  set auth_token(new_auth_token) {
    if (new_auth_token) {
      this.#auth_token = new_auth_token;
    } else {
      this.#auth_token = null;
    }
  }

  get element() {
    return this.#chart_el;
  }

  get loading() {
    return !this.#destroyed && m_busy_spinner.has_busy_spinner(this.#chart_el);
  }

  /**
   * Will be `true` if the chart is visible, displaying something, and not loading.
   */
  get usable() {
    return (
      !this.#destroyed &&
      this.#active == e_activation.active &&
      ![this.#min_x, this.#max_x, this.#min_y, this.#max_y].includes(null) &&
      !this.loading
    );
  }

  #set_loading() {
    if (this.loading) {
      return;
    }

    const spinner = m_busy_spinner.create(
      {with_overlay: true, size: m_busy_spinner.e_spinner_size.x_large}
    );
    this.#chart_el.append(spinner);
  }

  #clear_loading() {
    m_busy_spinner.remove_overlay(this.#chart_el);
  }

  #destroy_resize_observer() {
    if (this.#resize_observer) {
      if (this.#active == e_activation.active) {
        this.#resize_observer.disconnect();
      }
      this.#resize_observer = null;
    }
  }

  cancel() {
    if (this.#destroyed) {
      return;
    }

    this.#close_resolve_fn({reason: e_chart_close_reason.cancelled});
  }

  // TODO: Use or remove
  async #on_location_selected(location_type, location) {
    if (this.#location_change_queue.is_busy) {
      // Don't allow a location to be clicked while we are changing map location.
      return;
    }

    await this.set_location(location_type, location, e_location_view_type.zoomed_in_to);
  }

  async set_location(type, symbol, view) {
    if (this.#destroyed) {
      return;
    }
    k_log.raise_if(!this.#auth_token, "Missing authentication token");

    this.#location_change_queue.push(async () => {
      if (this.#destroyed) {
        return;
      }

      if (type == e_location_type.system && view == e_location_view_type.centered_on) {
        // We are loading the universe map not a system map.
        this.#current_system = null;
        this.#current_waypoint = null;
        // TODO: Load and render universe data
        throw new Error("Not yet implemented");
      } else {
        // We are loading a system or a waypoint orbital map
        if (type == e_location_type.system) {
          if (!this.#current_system || symbol != this.#current_system.system.symbol) {
            k_log.raise_if(!this.#auth_token, "Missing authentication token");
            const response = await m_server.star_chart.waypoints(this.#auth_token, symbol);
            k_log.raise_if(!response.success, "Failed to get system data from server:",
                           response.error_message);
            this.#current_system = response.result;
          }
          this.#current_waypoint = null;
        } else { // type == e_location_type.waypoint
          if (!this.#current_system || !(symbol in this.#current_system.waypoints)) {
            k_log.raise_if(!this.#auth_token, "Missing authentication token");
            const response = await m_server.star_chart.sibling_waypoints(this.#auth_token, symbol);
            k_log.raise_if(!response.success, "Failed to get waypoint data from server:",
                           response.error_message);
            this.#current_system = response.result;
          }
          if (view == e_location_view_type.zoomed_in_to) {
            this.#current_waypoint = symbol;
          } else {
            this.#current_waypoint = this.#current_system.waypoints[symbol].orbits;
          }
        }
        if (this.#destroyed) {
          return;
        }
        this.#system_char_initial_render();
      }
    });
  }

  #reset_chart_el() {
    this.#destroy_resize_observer();
    this.#chart_el.replaceChildren();

    this.#min_x = null;
    this.#max_x = null;
    this.#min_y = null;
    this.#max_y = null;
  }

  #end_pan() {
    if (this.#pan_interval_id != null) {
      clearInterval(this.#pan_interval_id);
      this.#pan_interval_id = null;
    }
    this.#x_pan = e_pan_direction.none;
    this.#y_pan = e_pan_direction.none;
  }

  /**
   * Sets up document-wide listeners for chart interaction events.
   */
  activate() {
    if (this.#active == e_activation.active) {
      return;
    }
    this.#active = e_activation.active;

    // Lazily define the navigation callbacks.
    if (!this.#navigation_callbacks) {
      this.#navigation_callbacks = {
        wheel: event => {
          if (event.wheelDeltaY == 0 || !this.usable) {
            return;
          }
          this.#system_char_rerender(e_rerender_reason.zoom, {zoom_by: event.wheelDeltaY});
        },
        keydown: event => {
          switch (event.code) {
          case "ArrowLeft":
          case "KeyA":
            if (this.#x_pan == e_pan_direction.negative) {
              return;
            }
            this.#x_pan = e_pan_direction.negative;
            break;
          case "ArrowRight":
          case "KeyD":
            if (this.#x_pan == e_pan_direction.positive) {
              return;
            }
            this.#x_pan = e_pan_direction.positive;
            break;
          case "ArrowUp":
          case "KeyW":
            if (this.#y_pan == e_pan_direction.positive) {
              return;
            }
            this.#y_pan = e_pan_direction.positive;
            break;
          case "ArrowDown":
          case "KeyS":
            if (this.#y_pan == e_pan_direction.negative) {
              return;
            }
            this.#y_pan = e_pan_direction.negative;
            break;
          default:
            return;
          }
          if (this.#pan_interval_id == null) {
            this.#pan_interval_id = setInterval(
              () => this.#system_char_rerender(e_rerender_reason.pan),
              k_pan_interval_ms
            );
            this.#system_char_rerender(e_rerender_reason.pan);
          }
        },
        keyup: event => {
          switch (event.code) {
          case "ArrowLeft":
          case "KeyA":
          case "ArrowRight":
          case "KeyD":
            if (this.#x_pan == e_pan_direction.none) {
              return;
            }
            this.#x_pan = e_pan_direction.none;
            break;
          case "ArrowUp":
          case "KeyW":
          case "ArrowDown":
          case "KeyS":
            if (this.#y_pan == e_pan_direction.none) {
              return;
            }
            this.#y_pan = e_pan_direction.none;
            break;
          default:
            return;
          }
          if (this.#x_pan == e_pan_direction.none && this.#y_pan == e_pan_direction.none) {
            this.#end_pan();
          }
        },
      };
    }

    if (this.#resize_observer) {
      this.#resize_observer.observe(this.#chart_el);
      // Quite possibly we would have fired this when the observer was disconnected, so fire it
      // now.
      this.#system_char_rerender(e_rerender_reason.chart_resize);
    }

    for (const event in this.#navigation_callbacks) {
      document.addEventListener(event, this.#navigation_callbacks[event]);
    }
  }

  /**
   * Removes document-wide listeners for chart interaction events.
   */
  deactivate() {
    if (this.#active == e_activation.inactive) {
      return;
    }
    this.#active = e_activation.inactive;

    if (this.#resize_observer) {
      this.#resize_observer.disconnect();
    }

    this.#end_pan();

    for (const event in this.#navigation_callbacks) {
      document.removeEventListener(event, this.#navigation_callbacks[event]);
    }
  }

  /**
   * This function should only be used for the initial render.
   *
   * Waypoint data for this system must already be loaded.
   */
  #system_char_initial_render() {
    this.#reset_chart_el();
    for (const symbol in this.#current_system.waypoints) {
      this.#current_system.waypoints[symbol].rendered = false;
    }

    // TODO: Render back button

    this.#resize_observer = new ResizeObserver(entries => {
      this.#system_char_rerender(e_rerender_reason.chart_resize);
    });
    if (this.#active != e_activation.active) {
      this.#resize_observer.observe(this.#chart_el);
    }

    this.#system_char_rerender(e_rerender_reason.initial_render);
  }

  /**
   * @param reason
   *        A value from `e_rerender_reason` that explains why we are re-rendering.
   * @param zoom_by
   *        An integer. Should be specified if `reason == e_rerender_reason.zoom`. Positive to zoom
   *        in, negative to zoom out. Magnitude indicates how much should to zoom by. This value
   *        will be that of `WheelEvent.wheelDeltaY`.
   */
  #system_char_rerender(reason, {zoom_by} = {}) {
    const waypoints = [];
    for (const symbol in this.#current_system.waypoints) {
      const waypoint = this.#current_system.waypoints[symbol];
      if (waypoint.orbits == this.#current_waypoint) {
        waypoints.push(waypoint);
      }
    }

    const bound_box = this.#chart_el.getBoundingClientRect();

    if (bound_box.width == 0 || bound_box.height == 0 || waypoints.length < 1) {
      this.#chart_el.replaceChildren();
      for (const symbol in this.#current_system.waypoints) {
        this.#current_system.waypoints[symbol].rendered = false;
      }
      return;
    }

    const resize_to_fit = reason == e_rerender_reason.chart_resize || this.#min_x == null;
    if (resize_to_fit) {
      // We are going to initially display the system to fit the chart.
      this.#min_x = waypoints.reduce(
        (acc, curr) => curr.position.x < acc ? curr.position.x : acc,
        Infinity
      );
      this.#max_x = waypoints.reduce(
        (acc, curr) => curr.position.x > acc ? curr.position.x : acc,
        -Infinity
      );
      this.#min_y = waypoints.reduce(
        (acc, curr) => curr.position.y < acc ? curr.position.y : acc,
        Infinity
      );
      this.#max_y = waypoints.reduce(
        (acc, curr) => curr.position.y > acc ? curr.position.y : acc,
        -Infinity
      );
    }

    let x_span = this.#max_x - this.#min_x;
    let y_span = this.#max_y - this.#min_y;

    let pixels_per_coord = Math.min(bound_box.width / x_span, bound_box.height / y_span);

    let waypoint_size;
    let waypoint_padding_width;
    let waypoint_border_width;
    let waypoint_total_size_halved;
    const update_waypoint_size = () => {
      waypoint_size = k_waypoint_image_base_size * pixels_per_coord;
      waypoint_padding_width = k_waypoint_padding_base_width * pixels_per_coord;
      waypoint_border_width = k_waypoint_border_base_width * pixels_per_coord;
      waypoint_total_size_halved =
        (waypoint_size + (waypoint_padding_width * 2) + (waypoint_border_width * 2)) / 2;
    };

    if (resize_to_fit) {
      // The extra space we reserve for the waypoint element overestimates slightly because the
      // waypoint element size needs to be recalculated after we effectively zoom out slightly to
      // add padding. But this would be more effort to correct than I care to put in.
      update_waypoint_size();

      const buffer = ((waypoint_total_size_halved + k_system_edge_buffer_px) / pixels_per_coord);
      this.#min_x -= buffer;
      this.#max_x += buffer;
      this.#min_y -= buffer;
      this.#max_y += buffer;

      x_span = this.#max_x - this.#min_x;
      y_span = this.#max_y - this.#min_y;
      pixels_per_coord = Math.min(bound_box.width / x_span, bound_box.height / y_span);
    }

    if (reason == e_rerender_reason.zoom) {
      pixels_per_coord = Math.max(
        pixels_per_coord * (1 + (zoom_by * k_system_zoom_multiplier)),
        k_system_min_pixels_per_coord
      );
    }

    if (resize_to_fit || reason == e_rerender_reason.zoom) {
      const center_x = (x_span / 2) + this.#min_x;
      const center_y = (y_span / 2) + this.#min_y;
      x_span = bound_box.width / pixels_per_coord;
      y_span = bound_box.height / pixels_per_coord;
      let x_edge_offset = x_span / 2;
      let y_edge_offset = y_span / 2;
      this.#min_x = center_x - x_edge_offset;
      this.#max_x = center_x + x_edge_offset;
      this.#min_y = center_y - y_edge_offset;
      this.#max_y = center_y + y_edge_offset;

      x_span = this.#max_x - this.#min_x;
      y_span = this.#max_y - this.#min_y;

      // Assuming that we got the aspect ratio right.
      pixels_per_coord = bound_box.width / x_span;
    }

    if (reason == e_rerender_reason.pan) {
      const pan_distance = k_pan_base_distance / pixels_per_coord;
      if (this.#x_pan == e_pan_direction.positive) {
        this.#min_x += pan_distance;
        this.#max_x += pan_distance;
      } else if (this.#x_pan == e_pan_direction.negative) {
        this.#min_x -= pan_distance;
        this.#max_x -= pan_distance;
      }
      if (this.#y_pan == e_pan_direction.positive) {
        this.#min_y += pan_distance;
        this.#max_y += pan_distance;
      } else if (this.#y_pan == e_pan_direction.negative) {
        this.#min_y -= pan_distance;
        this.#max_y -= pan_distance;
      }
    }

    const to_render = [];
    const to_move = [];
    const to_unrender = [];
    let upper_overflow = false;
    let lower_overflow = false;
    let left_overflow = false;
    let right_overflow = false;

    for (const waypoint of waypoints) {
      let should_render = true;
      if (waypoint.position.x < this.#min_x) {
        should_render = false;
        left_overflow = true;
      } else if (waypoint.position.x > this.#max_x) {
        should_render = false;
        right_overflow = true;
      }
      if (waypoint.position.y < this.#min_y) {
        should_render = false;
        lower_overflow = true;
      } else if (waypoint.position.y > this.#max_y) {
        should_render = false;
        upper_overflow = true;
      }

      if (should_render) {
        if (waypoint.rendered) {
          to_move.push(waypoint);
        } else {
          to_render.push(waypoint);
        }
      } else {
        if (waypoint.rendered) {
          to_unrender.push(waypoint);
        }
      }
    }

    update_waypoint_size();
    const display_x = waypoint =>
      (bound_box.width * (waypoint.position.x - this.#min_x) / x_span) -
      waypoint_total_size_halved;
    const display_y = waypoint =>
      (bound_box.height * (waypoint.position.y - this.#min_y) / y_span) -
      waypoint_total_size_halved;
    const waypoint_id = waypoint =>
      k_location_id_prefix + this.#chart_id + "_" + waypoint.symbol;

    for (const waypoint of to_render) {
      const waypoint_el = document.createElement("img");
      waypoint_el.classList.add(k_location_class_name);
      waypoint_el.id = waypoint_id(waypoint);
      waypoint_el.setAttribute(k_location_symbol_attr, waypoint.symbol);
      waypoint_el.src = "/client/img/star_chart/waypoint/fallback.svg";
      waypoint_el.style.width = `${waypoint_size}px`;
      waypoint_el.style.height = `${waypoint_size}px`;
      waypoint_el.style.left = `${display_x(waypoint)}px`;
      waypoint_el.style.bottom = `${display_y(waypoint)}px`;
      waypoint_el.style.padding = `${waypoint_padding_width}px`;
      waypoint_el.style["border-width"] = `${waypoint_border_width}px`;

      // TODO: Render tooltip
      // TODO: handle waypoint click

      if (waypoint.orbitals.length > 0) {
        waypoint_el.classList.add(k_orbited_location_class_name, k_clickable_location_class_name);
      } else if (this.#selection_type == e_selection_type.waypoint) {
        waypoint_el.classList.add(k_clickable_location_class_name);
      }

      this.#chart_el.append(waypoint_el);
      waypoint.rendered = true;
    }

    for (const waypoint of to_move) {
      const waypoint_el = document.getElementById(waypoint_id(waypoint));
      waypoint_el.style.left = `${display_x(waypoint)}px`;
      waypoint_el.style.bottom = `${display_y(waypoint)}px`;
      waypoint_el.style.width = `${waypoint_size}px`;
      waypoint_el.style.height = `${waypoint_size}px`;
      waypoint_el.style.padding = `${waypoint_padding_width}px`;
      waypoint_el.style["border-width"] = `${waypoint_border_width}px`;
    }

    for (const waypoint of to_unrender) {
      document.getElementById(waypoint_id(waypoint)).remove();
      waypoint.rendered = false;
    }

    if (upper_overflow) {
      if (!this.#upper_overflow_indicator) {
        this.#upper_overflow_indicator = document.createElement("div");
        this.#upper_overflow_indicator.classList.add(k_overflow_indicator_class_name,
                                                     k_upper_overflow_indicator_class_name);
        this.#chart_el.append(this.#upper_overflow_indicator);
      }
    } else {
      if (this.#upper_overflow_indicator) {
        this.#upper_overflow_indicator.remove();
        this.#upper_overflow_indicator = null;
      }
    }
    if (lower_overflow) {
      if (!this.#lower_overflow_indicator) {
        this.#lower_overflow_indicator = document.createElement("div");
        this.#lower_overflow_indicator.classList.add(k_overflow_indicator_class_name,
                                                     k_lower_overflow_indicator_class_name);
        this.#chart_el.append(this.#lower_overflow_indicator);
      }
    } else {
      if (this.#lower_overflow_indicator) {
        this.#lower_overflow_indicator.remove();
        this.#lower_overflow_indicator = null;
      }
    }
    if (left_overflow) {
      if (!this.#left_overflow_indicator) {
        this.#left_overflow_indicator = document.createElement("div");
        this.#left_overflow_indicator.classList.add(k_overflow_indicator_class_name,
                                                    k_left_overflow_indicator_class_name);
        this.#chart_el.append(this.#left_overflow_indicator);
      }
    } else {
      if (this.#left_overflow_indicator) {
        this.#left_overflow_indicator.remove();
        this.#left_overflow_indicator = null;
      }
    }
    if (right_overflow) {
      if (!this.#right_overflow_indicator) {
        this.#right_overflow_indicator = document.createElement("div");
        this.#right_overflow_indicator.classList.add(k_overflow_indicator_class_name,
                                                     k_right_overflow_indicator_class_name);
        this.#chart_el.append(this.#right_overflow_indicator);
      }
    } else {
      if (this.#right_overflow_indicator) {
        this.#right_overflow_indicator.remove();
        this.#right_overflow_indicator = null;
      }
    }
  }
}

/**
 * Opens a popup showing the star chart. Resolves when the popup closes. The popup can be cancelled
 * via overlay or the Escape key, in which case the return object will have `reason` set to
 * `e_chart_close_reason.cancelled`.
 *
 * Arguments match those of `StarChart.constructor`.
 *
 * @returns
 *    Return value matches that of `StarChart.until_close`.
 */
export async function popup(
  selection_type, auth_token, initial_location_type = null, initial_location = null,
  location_view_type = null
) {
  const chart = new StarChart(
    selection_type,
    e_activation.active,
    auth_token,
    initial_location_type, initial_location, location_view_type
  );

  let popup_close_fn;
  let popup_close_promise;
  await new Promise(resolve => {
    popup_close_promise = m_popup.show({
      element: chart.element,
      allow_non_button_close: true,
      max_size: true,
      fn: close => {
        popup_close_fn = close;
        resolve();
      },
    });
  });

  popup_close_promise.then(close => {
    if (close.reason != m_popup.e_close_reason.fn) {
      chart.cancel();
    }
  });

  return chart.until_close().finally(popup_close_fn);
}