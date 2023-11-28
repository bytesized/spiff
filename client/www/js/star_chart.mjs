import * as m_busy_spinner from "./busy_spinner.mjs";
import * as m_fn_queue from "./fn_queue.mjs";
import * as m_list from "./list.mjs";
import * as m_log from "./log.mjs";
import * as m_popup from "./popup.mjs";
import * as m_server from "./server.mjs";
import * as m_server_events from "./server_events.mjs";
import * as m_utils from "./utils.mjs";

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
const k_location_icon_class_name = "icon";
const k_orbited_location_class_name = "orbited";
const k_clickable_location_class_name = "clickable";
const k_location_symbol_attr = "data-symbol";

const k_back_button_background_class_name = "back_button_background";
const k_back_button_image_class_name = "back_button_image";
const k_layer_class_name = "layer";
const k_left_overflow_indicator_class_name = "left";
const k_lower_overflow_indicator_class_name = "bottom";
const k_overflow_indicator_class_name = "overflow_indicator";
const k_right_overflow_indicator_class_name = "right";
const k_tooltip_class_name = "tooltip";
const k_tooltip_data_list_class_name = "data_list";
const k_tooltip_expanded_trait_class_name = "expanded";
const k_tooltip_trait_description_class_name = "trait_description";
const k_upper_overflow_indicator_class_name = "top";

const k_orbital_view_pixels_per_coordinate = 1;
const k_pan_base_distance = 5;
const k_pan_interval_ms = 25;
const k_system_edge_buffer_px = 25;
const k_system_min_pixels_per_coord = 0.08;
const k_system_zoom_multiplier = 0.001;
const k_tooltip_width_px = 400;
const k_waypoint_border_base_width = 0.2;
const k_waypoint_image_base_size = 20;
const k_waypoint_padding_base_width = 3;

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
  #chart_id;
  #close_resolve_fn;
  #close_promise;
  #navigation_callbacks = null;

  #chart_el;
  #busy_spinner_layer_el;
  #overlay_layer_el;
  #display_layer_el;

  // If non-`null`, matches the `result` format of the `server/star_chart/local_systems` local API
  // endpoint.
  #local_universe = null; // TODO
  // If non-`null`, matches the `result` format of the `server/star_chart/waypoints` and
  // `server/star_chart/sibling_waypoints` local API endpoints. If `null`, we are viewing the
  // universe chart.
  #current_system = null;
  // If non-`null`, will be the symbol of a waypoint in `#current_system`. This will represent the
  // waypoint that we are viewing the orbitals of. If `null`, we are viewing the entire system or
  // the universe chart.
  // Will never be non-`null` while `#current_system` is `null`.
  #current_waypoint = null;

  // `#loaded_locations` will always be an object containing entries corresponding to locations
  // (system or waypoint). The entries are populated lazily as they are rendered. If
  // `#current_system` is `null` (we are displaying the whole universe), entries will be removed
  // when they are too far outside of the current view in order to keep us from ever having the
  // whole universe loaded into this variable at once. If `#current_system` is non-`null` (we are
  // displaying a system or the orbitals of a waypoint), entries won't be removed until we the view
  // navigates away from the current system.
  //
  // Each entry will use the system/waypoint symbol as a key. The value will be an object that may
  // contain these keys:
  //   connect_tooltip_show_listener
  //     Connects an event listener so that the tooltip is shown on waypoint mouseover.
  //   disconnect_tooltip_show_listener
  //     Disconnects the event listener that shows the tooltip on waypoint mouseover.
  //   el
  //     Will be present if the waypoint is currently rendered. Will be the parent DOM element
  //     containing the entire representation of the waypoint. This may be larger than the
  //     `icon_el`. This element will define the area over which hovering will open the tooltip.
  //   el_size
  //     The pixel size of the of the waypoint element. Will be present if the waypoint is
  //     currently rendered.
  //   el_x
  //     The pixel x position of the left edge of the waypoint element. Will be present if the
  //     waypoint is currently rendered.
  //   el_y
  //     The pixel y position of the bottom edge of the waypoint element. Will be present if the
  //     waypoint is currently rendered.
  //   icon_el
  //     Will be present if the icon is currently rendered. Will be the DOM element that visually
  //     represents the waypoint.
  //   index
  //     Will be present if the star chart is displaying the orbitals of a waypoint and this
  //     waypoint is one of the orbitals. Will be an integer indicating the sorted position of the
  //     orbital relative to the other orbitals. May contain stale data if `!rendered`.
  //   position
  //     Always present. Will be a reference to the `position` object in the corresponding entry in
  //     `#current_system.waypoints` or `#local_universe`.
  //   rendered
  //     Always present. Will be `true` if the waypoint is currently rendered.
  //   tooltip_el
  //     Will be present if the waypoint is currently rendered. Will be the DOM element
  //     representing the tooltip for the waypoint
  //   tooltip_show_fn
  //     Will be present if the waypoint is currently rendered. Will be a function taking no
  //     arguments that, when called, renders the waypoint's tooltip.
  //   symbol
  //     Always present. Matches the key for the entry.
  #loaded_locations = {};

  // Only one tooltip is added to the DOM at a time since we need to properly size and position the
  // tooltip each time, there is no reason to put them all in the DOM at once. When a tooltip has
  // been added to the DOM, this variable will be the symbol of the location that the tooltip
  // belongs to. When the tooltip is removed from the DOM, this will be set back to `null`.
  #active_tooltip_location = null;
  // If non-`null`, matches the `result` format of the `server/star_chart/universe_bounds` local
  // API endpoint. Will not be `null` if the universe map has ever been displayed.
  #universe_bounds = null;

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

  // These are for tracking mouse movement (since we can't just request the mouse position, for
  // some odd reason). They are directly assigned from `MouseEvent.clientX` and
  // `MouseEvent.clientY`
  #mouse_x = null;
  #mouse_y = null;

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
   *        for `initial_location`. If this is `e_location_type.system`, the star chart will start
   *        in the system view. If it is `e_location_type.waypoint`, the star chart will start
   *        zoomed into the relevant system, but the user can back out to see the system view.
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
   * TODO: Add argument/method to allow certain waypoints/systems to be recolored/marked.
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

    // Ordering is important here so that the layers stack in the correct order. Layers created
    // later are on top of layers created earlier.
    this.#chart_el = m_utils.create_el("div", {classes: [k_star_chart_class_name]});
    this.#display_layer_el =
      m_utils.create_el("div", {parent: this.#chart_el, classes: [k_layer_class_name]});
    this.#overlay_layer_el =
      m_utils.create_el("div", {parent: this.#chart_el, classes: [k_layer_class_name]});
    this.#busy_spinner_layer_el =
      m_utils.create_el("div", {parent: this.#chart_el, classes: [k_layer_class_name]});

    // Apparently we can't just get the mouse position for some reason. We have to track it so it's
    // available when we want to zoom towards where the mouse is.
    this.#chart_el.addEventListener("mousemove", this.#on_mouse_move.bind(this));
    this.#chart_el.addEventListener("wheel", event => {
      if (event.wheelDeltaY == 0 || !this.usable || this.#current_waypoint) {
        return;
      }
      if (this.#active_tooltip_location) {
        const tooltip_bound_box =
          this.#loaded_locations[this.#active_tooltip_location].tooltip_el.getBoundingClientRect();
        if (this.#bound_box_contains_mouse(tooltip_bound_box)) {
          return;
        }
      }
      const render_options = {zoom_by: event.wheelDeltaY};
      const bound_box = this.#chart_el.getBoundingClientRect();
      if (this.#mouse_x != null) {
        render_options.zoom_center_x = (this.#mouse_x - bound_box.x) / bound_box.width;
      }
      // We need to invert this value because `MouseEvent.clientY` is the distance from the top
      // whereas the map Y coordinates measure from the bottom.
      if (this.#mouse_y != null) {
        render_options.zoom_center_y = 1 - ((this.#mouse_y - bound_box.y) / bound_box.height);
      }
      this.#chart_rerender(e_rerender_reason.zoom, render_options);
    });

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

  #on_mouse_move(event) {
    this.#mouse_x = event.clientX;
    this.#mouse_y = event.clientY;
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
    return !this.#destroyed && m_busy_spinner.has_busy_spinner(this.#busy_spinner_layer_el);
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
    this.#busy_spinner_layer_el.append(spinner);
  }

  #clear_loading() {
    m_busy_spinner.remove_overlay(this.#busy_spinner_layer_el);
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

  async #set_location_if_not_busy(type, symbol, view) {
    if (this.#location_change_queue.is_busy) {
      // Don't allow a location to be clicked while we are changing map location.
      return;
    }

    await this.set_location(type, symbol, view);
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

        if (!this.#universe_bounds) {
          const response = await m_server.star_chart.universe_bounds();
          k_log.raise_if(!response.success, "Failed to get universe bounds from server:",
                         response.error_message);
          this.#universe_bounds = response.result;
        }

        // TODO: Load and render universe data
        throw new Error("Not yet implemented");
      } else if (type == e_location_type.system) { // Zoomed into system
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
      this.#chart_initial_render();
    });
  }

  #reset_chart_el() {
    this.#destroy_resize_observer();
    this.#display_layer_el.replaceChildren();
    this.#overlay_layer_el.replaceChildren();

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
              () => this.#chart_rerender(e_rerender_reason.pan),
              k_pan_interval_ms
            );
            this.#chart_rerender(e_rerender_reason.pan);
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
      this.#chart_rerender(e_rerender_reason.chart_resize);
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
   * If displaying a system or waypoint orbitals, the waypoint data for the system must already be
   * loaded.
   */
  #chart_initial_render() {
    this.#reset_chart_el();
    this.#loaded_locations = {};

    const back_button_background = m_utils.create_el("div", {
      parent: this.#overlay_layer_el,
      classes: [k_back_button_background_class_name],
    });
    back_button_background.addEventListener("click", this.#on_back_button_click.bind(this));
    const back_button_image = m_utils.create_el("img", {
      parent: this.#overlay_layer_el,
      classes: [k_back_button_image_class_name],
    });
    back_button_image.src = "/client/img/back_arrow.svg";
    back_button_image.addEventListener("click", this.#on_back_button_click.bind(this));

    this.#resize_observer = new ResizeObserver(entries => {
      this.#mouse_x = null;
      this.#mouse_y = null;

      this.#chart_rerender(e_rerender_reason.chart_resize);
    });
    if (this.#active == e_activation.active) {
      this.#resize_observer.observe(this.#chart_el);
    }

    this.#chart_rerender(e_rerender_reason.initial_render);
  }

  /**
   * @param reason
   *        A value from `e_rerender_reason` that explains why we are re-rendering.
   * @param zoom_by
   *        An integer. Should be specified if `reason == e_rerender_reason.zoom`. Positive to zoom
   *        in, negative to zoom out. Magnitude indicates how much should to zoom by. This value
   *        will be that of `WheelEvent.wheelDeltaY`.
   * @param zoom_center_x
   *        The X position of the center point of the zoom (where we will zoom towards or away
   *        from). This is expressed as a ratio of the distance from the left edge of the map to
   *        the right edge of the map. It will therefore be a number between 0 and 1 (inclusive).
   *        Optionally specified if `reason == e_rerender_reason.zoom` (not used otherwise). If
   *        unspecified, it will be as if the cursor is in the center of the map.
   * @param zoom_center_y
   *        The Y position of the center point of the zoom (where we will zoom towards or away
   *        from). This is expressed as a ratio of the distance from the bottom edge of the map to
   *        the top edge of the map. It will therefore be a number between 0 and 1 (inclusive).
   *        Optionally specified if `reason == e_rerender_reason.zoom` (not used otherwise). If
   *        unspecified, it will be as if the cursor is in the center of the map.
   */
  #chart_rerender(reason, {zoom_by, zoom_center_x, zoom_center_y} = {}) {
    // Set `locations` to the `#loaded_locations` values for all loaded locations that could be
    // rendered in the current view (not just what is going to be displayed).
    const locations = [];
    for (const symbol in this.#current_system.waypoints) {
      const waypoint = this.#current_system.waypoints[symbol];
      if (waypoint.orbits == this.#current_waypoint || symbol == this.#current_waypoint) {
        if (!(symbol in this.#loaded_locations)) {
          this.#loaded_locations[symbol] = {
            symbol,
            position: waypoint.position,
            rendered: false,
          };
        }
        locations.push(this.#loaded_locations[symbol]);
      }
    }
    if (this.#current_waypoint) {
      // When viewing the orbitals of a waypoint, there are not well defined positions to display
      // the orbitals at, so we pick fairly arbitrary positions based on their `index` value which
      // loosely corresponds to their ordering in the `locations` array. Make sure that ordering is
      // stable so that the orbital map displays the same way each time.
      locations.sort((a, b) => {
        if (a.symbol == b.symbol) {
          return 0;
        }
        if (a.symbol < b.symbol) {
          return -1;
        }
        return 1;
      });
      let index = 0;
      for (const location of locations) {
        if (location.symbol != this.#current_waypoint) {
          location.index = index;
          index += 1;
        }
      }
    }

    const chart_bound_box = this.#chart_el.getBoundingClientRect();

    // Past this point, we want to be able to assume that the size of the display is not 0 and the
    // number of things we are going to display in it is not 0.
    if (chart_bound_box.width == 0 || chart_bound_box.height == 0 || locations.length < 1) {
      this.#display_layer_el.replaceChildren();
      for (const symbol in this.#loaded_locations) {
        this.#loaded_locations[symbol].rendered = false;
      }
      return;
    }

    if (this.#current_waypoint) {
      // When viewing the orbitals of a waypoint, they all have the same coordinates. So defining
      // view bounds isn't really meaningful.
      this.#min_x = null;
      this.#max_x = null;
      this.#min_y = null;
      this.#max_y = null;
    }

    const resize_to_fit = this.#current_system && !this.#current_waypoint &&
                          (
                            reason == e_rerender_reason.chart_resize ||
                            this.#min_x == null
                          );
    if (resize_to_fit) {
      // We are going to initially display the system to fit the chart.
      this.#min_x = locations.reduce(
        (acc, curr) => curr.position.x < acc ? curr.position.x : acc,
        Infinity
      );
      this.#max_x = locations.reduce(
        (acc, curr) => curr.position.x > acc ? curr.position.x : acc,
        -Infinity
      );
      this.#min_y = locations.reduce(
        (acc, curr) => curr.position.y < acc ? curr.position.y : acc,
        Infinity
      );
      this.#max_y = locations.reduce(
        (acc, curr) => curr.position.y > acc ? curr.position.y : acc,
        -Infinity
      );
    }

    let x_span = this.#max_x - this.#min_x;
    let y_span = this.#max_y - this.#min_y;

    let pixels_per_coord;
    if (this.#current_waypoint) {
      pixels_per_coord = k_orbital_view_pixels_per_coordinate;
    } else {
      pixels_per_coord = Math.min(chart_bound_box.width / x_span, chart_bound_box.height / y_span);
    }

    let location_content_size;
    let location_padding_width;
    let location_border_width;
    let location_total_size;
    let location_total_size_halved;
    const update_location_size = () => {
      location_content_size = k_waypoint_image_base_size * pixels_per_coord;
      location_padding_width = k_waypoint_padding_base_width * pixels_per_coord;
      location_border_width = k_waypoint_border_base_width * pixels_per_coord;
      location_total_size =
        location_content_size + (location_padding_width * 2) + (location_border_width * 2);
      location_total_size_halved = location_total_size / 2;
    };

    if (resize_to_fit) {
      // The extra space we reserve for the waypoint element overestimates slightly because the
      // waypoint element size needs to be recalculated after we effectively zoom out slightly to
      // add padding. But this would be more effort to correct than I care to put in.
      update_location_size();

      const buffer = ((location_total_size_halved + k_system_edge_buffer_px) / pixels_per_coord);
      this.#min_x -= buffer;
      this.#max_x += buffer;
      this.#min_y -= buffer;
      this.#max_y += buffer;

      x_span = this.#max_x - this.#min_x;
      y_span = this.#max_y - this.#min_y;

      // We want to have the same number of pixels per coordinate in both dimensions. Whichever
      // dimension has fewer, adjust to match the other dimension.
      const pixels_per_coord_x = chart_bound_box.width / x_span;
      const pixels_per_coord_y = chart_bound_box.height / y_span;
      if (pixels_per_coord_x < pixels_per_coord_y) {
        // We are keeping the x axis how it is and adjusting the y axis.
        pixels_per_coord = pixels_per_coord_x;
        const center_y = (y_span / 2) + this.#min_y;
        y_span = chart_bound_box.height / pixels_per_coord;
        const y_edge_offset = y_span / 2;
        this.#min_y = center_y - y_edge_offset;
        this.#max_y = center_y + y_edge_offset;
      } else {
        // We are keeping the y axis how it is and adjusting the x axis.
        pixels_per_coord = pixels_per_coord_y;
        const center_x = (x_span / 2) + this.#min_x;
        x_span = chart_bound_box.width / pixels_per_coord;
        const x_edge_offset = x_span / 2;
        this.#min_x = center_x - x_edge_offset;
        this.#max_x = center_x + x_edge_offset;
      }
    } else if (reason == e_rerender_reason.zoom) {
      pixels_per_coord = Math.max(
        pixels_per_coord * (1 + (zoom_by * k_system_zoom_multiplier)),
        k_system_min_pixels_per_coord
      );

      const new_x_span = chart_bound_box.width / pixels_per_coord;
      const new_y_span = chart_bound_box.height / pixels_per_coord;
      const adjustment_x = new_x_span - x_span;
      const adjustment_y = new_y_span - y_span;

      // If we don't have a coordinate, zoom from the center.
      if (zoom_center_x == undefined) {
        zoom_center_x = 0.5;
      }
      if (zoom_center_y == undefined) {
        zoom_center_y = 0.5;
      }

      this.#min_x -= adjustment_x * zoom_center_x;
      this.#max_x += adjustment_x * (1 - zoom_center_x);
      this.#min_y -= adjustment_y * zoom_center_y;
      this.#max_y += adjustment_y * (1 - zoom_center_y);

      x_span = new_x_span;
      y_span = new_y_span;
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

    for (const location of locations) {
      let should_render = true;
      if (!this.#current_waypoint) {
        if (location.position.x < this.#min_x) {
          should_render = false;
          left_overflow = true;
        } else if (location.position.x > this.#max_x) {
          should_render = false;
          right_overflow = true;
        }
        if (location.position.y < this.#min_y) {
          should_render = false;
          lower_overflow = true;
        } else if (location.position.y > this.#max_y) {
          should_render = false;
          upper_overflow = true;
        }
      }

      if (should_render) {
        if (location.rendered) {
          to_move.push(location);
        } else {
          to_render.push(location);
        }
      } else {
        if (location.rendered) {
          to_unrender.push(location);
        }
      }
    }

    update_location_size();
    let display_x;
    let display_y;
    if (this.#current_waypoint) {
      const angular_spacing = 2 * Math.PI / (locations.length - 1);
      const orbit_distance = (Math.min(chart_bound_box.width, chart_bound_box.height) / 2) -
                             k_system_edge_buffer_px;
      const center_x = chart_bound_box.width / 2;
      const center_y = chart_bound_box.height / 2;
      display_x = location => {
        if (location.symbol == this.#current_waypoint) {
          return center_x - location_total_size_halved;
        }
        return (
          center_x +
          (Math.cos(angular_spacing * location.index) * orbit_distance) -
          location_total_size_halved
        );
      };
      display_y = location => {
        if (location.symbol == this.#current_waypoint) {
          return center_y - location_total_size_halved;
        }
        return (
          center_y +
          (Math.sin(angular_spacing * location.index) * orbit_distance) -
          location_total_size_halved
        );
      };
    } else {
      display_x = location =>
        (chart_bound_box.width * (location.position.x - this.#min_x) / x_span) -
        location_total_size_halved;
      display_y = location =>
        (chart_bound_box.height * (location.position.y - this.#min_y) / y_span) -
        location_total_size_halved;
    }

    for (const location of to_render) {
      const waypoint = this.#current_system.waypoints[location.symbol];

      if (!location.el) {
        location.el = m_utils.create_el("div", {classes: [k_location_class_name]});

        location.icon_el =
          m_utils.create_el("div", {parent: location.el, classes: [k_location_icon_class_name]});
        location.icon_el.setAttribute(k_location_symbol_attr, location.symbol);
        location.icon_el.style["background-image"] =
          "url(\"/client/img/star_chart/waypoint/fallback.svg\")";
        location.icon_el.style.padding = `${location_padding_width}px`;
        location.icon_el.style["border-width"] = `${location_border_width}px`;

        // TODO: Add line to tooltip if this is the headquarters.
        // TODO: Add ship count to tooltip.

        location.tooltip_el = m_utils.create_el("div", {classes: [k_tooltip_class_name]});
        m_utils.create_el("h1", {parent: location.tooltip_el, text: waypoint.symbol});
        const tooltip_list_el = m_utils.create_el("ul", {
          parent: location.tooltip_el,
          classes: [k_tooltip_data_list_class_name],
        });
        m_utils.create_el("li", {
          parent: tooltip_list_el,
          text: `Location: ${waypoint.position.x}, ${waypoint.position.y}`,
        });
        if (waypoint.orbits != null) {
          m_utils.create_el("li", {parent: tooltip_list_el, text: `Orbits: ${waypoint.orbits}`});
        }
        m_utils.create_el("li", {parent: tooltip_list_el, text: `Type: ${waypoint.type.symbol}`});
        const traits_li = m_utils.create_el("li", {parent: tooltip_list_el});
        m_utils.create_el("h2", {parent: traits_li, text: "Traits"});
        const traits = [];
        for (const trait of waypoint.traits) {
          const description_el = m_utils.create_el("p", {
            text: trait.description,
            classes: [k_tooltip_trait_description_class_name],
          });
          traits.push([trait.name, trait.name, description_el]);
        }
        const trait_click_handler = ({list, item, id}) => {
          item.classList.toggle(k_tooltip_expanded_trait_class_name);
          this.#position_size_and_show_tooltip(waypoint.symbol);
        };
        const trait_list = m_list.create_selectable(traits, trait_click_handler);
        traits_li.append(trait_list);
        if (waypoint.orbitals.length) {
          const orbitals_li = m_utils.create_el("li", {parent: tooltip_list_el});
          m_utils.create_el("h2", {parent: orbitals_li, text: "Orbitals"});
          const orbitals_list = m_utils.create_el("ul", {parent: orbitals_li});
          for (const orbital of waypoint.orbitals) {
            m_utils.create_el("li", {parent: orbitals_list, text: orbital});
          }
        }

        location.tooltip_show_fn = () => this.#position_size_and_show_tooltip(location.symbol);
        location.connect_tooltip_show_listener = () => {
          location.el.addEventListener("mouseenter", location.tooltip_show_fn);
        };
        location.disconnect_tooltip_show_listener = () => {
          location.el.removeEventListener("mouseenter", location.tooltip_show_fn);
        };

        location.el.addEventListener("click", async () => {
          if (waypoint.orbitals.length) {
            await this.#set_location_if_not_busy(e_location_type.waypoint, waypoint.symbol,
                                                 e_location_view_type.zoomed_in_to);
          } else if (this.#selection_type == e_selection_type.waypoint) {
            this.#close_resolve_fn({
              reason: e_chart_close_reason.selection,
              selection: waypoint.symbol
            });
          }
        });

        if (waypoint.orbitals.length) {
          location.el.classList.add(k_orbited_location_class_name);
        }
      }

      if (this.#selection_type == e_selection_type.waypoint ||
          (waypoint.orbitals.length && !this.#current_waypoint)) {
        location.el.classList.add(k_clickable_location_class_name);
      } else {
        location.el.classList.remove(k_clickable_location_class_name);
      }

      location.el_size = location_total_size;
      location.el_x = display_x(location);
      location.el_y = display_y(location);
      location.el.style.width = `${location_total_size}px`;
      location.el.style.height = `${location_total_size}px`;
      location.el.style.left = `${location.el_x}px`;
      location.el.style.bottom = `${location.el_y}px`;

      this.#display_layer_el.append(location.el);
      location.connect_tooltip_show_listener();
      location.rendered = true;
    }

    for (const location of to_move) {
      location.el_x = display_x(location);
      location.el_y = display_y(location);
      location.el_size = location_total_size;
      location.el.style.left = `${location.el_x}px`;
      location.el.style.bottom = `${location.el_y}px`;
      location.el.style.width = `${location_total_size}px`;
      location.el.style.height = `${location_total_size}px`;
      location.icon_el.style.padding = `${location_padding_width}px`;
      location.icon_el.style["border-width"] = `${location_border_width}px`;
    }

    for (const location of to_unrender) {
      location.el.remove();
      location.disconnect_tooltip_show_listener();
      location.rendered = false;
    }

    // If there is a tooltip already showing, we may need to adjust it, otherwise its sizing may be
    // wrong for the current window size.
    let tooltip_adjusted = false;
    if (this.#active_tooltip_location) {
      const tooltip_bound_box =
        this.#loaded_locations[this.#active_tooltip_location].tooltip_el.getBoundingClientRect();
      if (this.#bound_box_contains_mouse(tooltip_bound_box)) {
        this.#position_size_and_show_tooltip(this.#active_tooltip_location);
        tooltip_adjusted = true;
      }
    }
    if (!tooltip_adjusted) {
      const visible = to_render.concat(to_move);
      for (const location of visible) {
        const location_bound_box = location.el.getBoundingClientRect();
        if (this.#bound_box_contains_mouse(location_bound_box)) {
          this.#position_size_and_show_tooltip(location.symbol);
          tooltip_adjusted = true;
          break;
        }
      }
    }
    if (!tooltip_adjusted) {
      // We aren't over the tooltip or a location. Make sure the tooltip is hidden.
      this.#remove_current_tooltip();
    }

    if (upper_overflow) {
      if (!this.#upper_overflow_indicator) {
        this.#upper_overflow_indicator = m_utils.create_el("div", {
          parent: this.#display_layer_el,
          classes: [k_overflow_indicator_class_name, k_upper_overflow_indicator_class_name],
        });
      }
    } else {
      if (this.#upper_overflow_indicator) {
        this.#upper_overflow_indicator.remove();
        this.#upper_overflow_indicator = null;
      }
    }
    if (lower_overflow) {
      if (!this.#lower_overflow_indicator) {
        this.#lower_overflow_indicator = m_utils.create_el("div", {
          parent: this.#display_layer_el,
          classes: [k_overflow_indicator_class_name, k_lower_overflow_indicator_class_name],
        });
      }
    } else {
      if (this.#lower_overflow_indicator) {
        this.#lower_overflow_indicator.remove();
        this.#lower_overflow_indicator = null;
      }
    }
    if (left_overflow) {
      if (!this.#left_overflow_indicator) {
        this.#left_overflow_indicator = m_utils.create_el("div", {
          parent: this.#display_layer_el,
          classes: [k_overflow_indicator_class_name, k_left_overflow_indicator_class_name],
        });
      }
    } else {
      if (this.#left_overflow_indicator) {
        this.#left_overflow_indicator.remove();
        this.#left_overflow_indicator = null;
      }
    }
    if (right_overflow) {
      if (!this.#right_overflow_indicator) {
        this.#right_overflow_indicator = m_utils.create_el("div", {
          parent: this.#display_layer_el,
          classes: [k_overflow_indicator_class_name, k_right_overflow_indicator_class_name],
        });
      }
    } else {
      if (this.#right_overflow_indicator) {
        this.#right_overflow_indicator.remove();
        this.#right_overflow_indicator = null;
      }
    }
  }

  #position_size_and_show_tooltip(symbol) {
    const location = this.#loaded_locations[symbol];
    if (this.#active_tooltip_location != symbol) {
      if (this.#active_tooltip_location) {
        this.#remove_current_tooltip();
      }
      this.#active_tooltip_location = symbol;

      location.el.append(location.tooltip_el);
      location.tooltip_el.style.width = `${k_tooltip_width_px}px`;
    }

    // Reset the way we displayed it last time
    location.tooltip_el.style.overflow = "visible";
    location.tooltip_el.style.top = "auto";
    location.tooltip_el.style.bottom = "auto";
    location.tooltip_el.style.left = "auto";
    location.tooltip_el.style.right = "auto";

    // -1 to make sure there is at least a little overlap
    location.tooltip_el.style.left = `${location.el_size - 1}px`;
    location.tooltip_el.style.bottom = "0";

    let tooltip_bound_box = location.tooltip_el.getBoundingClientRect();
    const chart_bound_box = this.#chart_el.getBoundingClientRect();
    if (chart_bound_box.top > tooltip_bound_box.top) {
      const location_bound_box = location.el.getBoundingClientRect();
      location.tooltip_el.style.top = `${chart_bound_box.top - location_bound_box.top}px`;
      location.tooltip_el.style.bottom = "auto";
      tooltip_bound_box = location.tooltip_el.getBoundingClientRect();
      if (chart_bound_box.bottom < tooltip_bound_box.bottom) {
        location.tooltip_el.style.bottom =
          `${location_bound_box.bottom - chart_bound_box.bottom}px`;
        location.tooltip_el.style.overflow = "scroll";
      }
    }

    if (chart_bound_box.right < tooltip_bound_box.right) {
      location.tooltip_el.style.left = "auto";
      location.tooltip_el.style.right = `${location.el_size}px`;
    }
  }

  #remove_current_tooltip() {
    if (!this.#active_tooltip_location) {
      return;
    }

    const location = this.#loaded_locations[this.#active_tooltip_location];
    location.connect_tooltip_show_listener();
    location.tooltip_el.remove();

    this.#active_tooltip_location = null;
  }

  /**
   * @param box
   *        A `DOMRect`, typically one returned by `Element.getBoundingClientRect()`.
   * @returns
   *        `true` if the cursor's position is known and lies within `box`, else `false`.
   */
  #bound_box_contains_mouse(box) {
    if (this.#mouse_x == null || this.#mouse_y == null) {
      return false;
    }
    return bound_box_contains(box, this.#mouse_x, this.#mouse_y);
  }

  async #on_back_button_click() {
    if (this.#current_waypoint) {
      await this.#set_location_if_not_busy(e_location_type.waypoint, this.#current_waypoint,
                                           e_location_view_type.centered_on);
    } else if (this.#current_system) {
      await this.#set_location_if_not_busy(
        e_location_type.system,
        this.#current_system.system.symbol,
        e_location_view_type.centered_on
      );
    }
  }
}

/**
 * @param box
 *        A `DOMRect`, typically one returned by `Element.getBoundingClientRect()`.
 * @param x
 *        The x coordinate of the point to check.
 * @param y
 *        The y coordinate of the point to check.
 * @returns
 *        `true` if (`x`, `y`) lies within `box`, else `false`.
 */
function bound_box_contains(box, x, y) {
  if (box.width == 0 || box.height == 0) {
    // Even if the mouse is directly over the box location, never consider anything to be within a
    // zero-sized box.
    return false;
  }
  return box.top <= y && box.bottom >= y && box.left <= x && box.right >= x;
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
 *
 * TODO: This needs testing
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
