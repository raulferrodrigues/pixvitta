//! View calculations shared by the UIs. Pure functions of sizes, in
//! whatever unit the caller uses; nothing is rounded or snapped.
//!
//! Zoom follows the Electron app: the content is first fitted to the view
//! (`fit`), then scaled from 1x to 10x around the view's centre and moved by
//! a pan, which never lets the content's edge come inside the view's.

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// How far the content is zoomed and panned. `scale` multiplies the fitted
/// size; `pan_x` and `pan_y` move the content's centre away from the view's.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Zoom {
    pub scale: f64,
    pub pan_x: f64,
    pub pan_y: f64,
}

pub const MIN_ZOOM: f64 = 1.0;
pub const MAX_ZOOM: f64 = 10.0;
pub const UNZOOMED: Zoom = Zoom { scale: MIN_ZOOM, pan_x: 0.0, pan_y: 0.0 };

/// A wheel turn larger than this, in pixels, zooms as much as this.
const WHEEL_DELTA_LIMIT: f64 = 24.0;
/// Percent of zoom per pixel of wheel turn.
const WHEEL_ZOOM_PER_PIXEL: f64 = 2.4;

const EMPTY: Rect = Rect { x: 0.0, y: 0.0, width: 0.0, height: 0.0 };

fn usable(size: Size) -> bool {
    [size.width, size.height].into_iter().all(|side| side.is_finite() && side > 0.0)
}

/// Where content is drawn in a view: scaled down to fit with its aspect
/// ratio kept, never scaled up (the Electron app's default, "native or
/// smaller"), and centred. Any size that is not finite and positive gives
/// an empty rect at the origin.
pub fn fit(content: Size, view: Size) -> Rect {
    if !usable(content) || !usable(view) {
        return EMPTY;
    }
    let scale = (view.width / content.width).min(view.height / content.height).min(1.0);
    let width = content.width * scale;
    let height = content.height * scale;
    Rect { x: (view.width - width) / 2.0, y: (view.height - height) / 2.0, width, height }
}

/// Where content is drawn in a view at the given zoom. The zoom is used as
/// it is; keep it within its limits with `zoom_by` and `pan_by`.
pub fn zoomed(content: Size, view: Size, zoom: Zoom) -> Rect {
    let fitted = fit(content, view);
    if fitted == EMPTY {
        return EMPTY;
    }
    let width = fitted.width * zoom.scale;
    let height = fitted.height * zoom.scale;
    Rect {
        x: (view.width - width) / 2.0 + zoom.pan_x,
        y: (view.height - height) / 2.0 + zoom.pan_y,
        width,
        height,
    }
}

/// Multiplies the zoom by `factor`, kept between 1x and 10x, so that the
/// point of the content under (`x`, `y`) in the view stays there, as far as
/// the pan limits allow. Zoom by keys around the view's centre and by wheel
/// or pinch around the pointer. Unusable sizes give `UNZOOMED`; a factor that
/// is not finite and positive changes nothing.
pub fn zoom_by(content: Size, view: Size, zoom: Zoom, factor: f64, x: f64, y: f64) -> Zoom {
    if !usable(content) || !usable(view) {
        return UNZOOMED;
    }
    if !(factor.is_finite() && factor > 0.0 && x.is_finite() && y.is_finite()) {
        return clamp(content, view, zoom);
    }
    let mut scale = (zoom.scale * factor).clamp(MIN_ZOOM, MAX_ZOOM);
    // Zooming out step by step can land a rounding error above 1x.
    if scale - MIN_ZOOM < 1e-9 {
        scale = MIN_ZOOM;
    }
    let ratio = scale / zoom.scale;
    let from_centre_x = x - view.width / 2.0;
    let from_centre_y = y - view.height / 2.0;
    clamp(
        content,
        view,
        Zoom {
            scale,
            pan_x: zoom.pan_x * ratio + from_centre_x * (1.0 - ratio),
            pan_y: zoom.pan_y * ratio + from_centre_y * (1.0 - ratio),
        },
    )
}

/// Moves the content by (`dx`, `dy`) within the pan limits: the content's
/// edge never comes inside the view's, and content smaller than the view
/// stays centred. Call it with no movement after the view or content
/// changes size, to bring the pan back within the new limits.
pub fn pan_by(content: Size, view: Size, zoom: Zoom, dx: f64, dy: f64) -> Zoom {
    if !usable(content) || !usable(view) {
        return UNZOOMED;
    }
    let dx = if dx.is_finite() { dx } else { 0.0 };
    let dy = if dy.is_finite() { dy } else { 0.0 };
    clamp(content, view, Zoom { pan_x: zoom.pan_x + dx, pan_y: zoom.pan_y + dy, ..zoom })
}

fn clamp(content: Size, view: Size, zoom: Zoom) -> Zoom {
    let scale = if zoom.scale.is_finite() { zoom.scale.clamp(MIN_ZOOM, MAX_ZOOM) } else { MIN_ZOOM };
    let fitted = fit(content, view);
    let limit_x = ((fitted.width * scale - view.width) / 2.0).max(0.0);
    let limit_y = ((fitted.height * scale - view.height) / 2.0).max(0.0);
    let pan = |pan: f64, limit: f64| if pan.is_finite() { pan.clamp(-limit, limit) } else { 0.0 };
    Zoom { scale, pan_x: pan(zoom.pan_x, limit_x), pan_y: pan(zoom.pan_y, limit_y) }
}

/// The zoom factor for a wheel turn of `delta` pixels, positive to zoom in
/// (Qt's angle delta, 120 a notch, can be passed as it is). Turns past 24
/// pixels count as 24, so one notch zooms by about 1.58x, as in the Electron
/// app.
pub fn wheel_zoom_factor(delta: f64) -> f64 {
    if !delta.is_finite() {
        return 1.0;
    }
    let step = 1.0 + delta.abs().min(WHEEL_DELTA_LIMIT) * WHEEL_ZOOM_PER_PIXEL / 100.0;
    if delta >= 0.0 {
        step
    } else {
        1.0 / step
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn size(width: f64, height: f64) -> Size {
        Size { width, height }
    }

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect { x, y, width, height }
    }

    fn zoom(scale: f64, pan_x: f64, pan_y: f64) -> Zoom {
        Zoom { scale, pan_x, pan_y }
    }

    // PV_ZOOM_STEP in pixvitta.h, which the UIs use for keyboard zoom.
    const ZOOM_STEP: f64 = 1.35;
    const VIEW: Size = Size { width: 800.0, height: 600.0 };
    // Fits the view as 800 x 400.
    const WIDE: Size = Size { width: 2000.0, height: 1000.0 };

    #[test]
    fn wider_than_the_view_fills_its_width() {
        assert_eq!(fit(WIDE, VIEW), rect(0.0, 100.0, 800.0, 400.0));
    }

    #[test]
    fn taller_than_the_view_fills_its_height() {
        assert_eq!(fit(size(1000.0, 2000.0), VIEW), rect(250.0, 0.0, 300.0, 600.0));
    }

    #[test]
    fn same_aspect_fills_the_view() {
        assert_eq!(fit(size(1600.0, 1200.0), VIEW), rect(0.0, 0.0, 800.0, 600.0));
    }

    #[test]
    fn smaller_than_the_view_keeps_its_size() {
        assert_eq!(fit(size(200.0, 100.0), VIEW), rect(300.0, 250.0, 200.0, 100.0));
    }

    #[test]
    fn degenerate_sizes_give_an_empty_rect_and_no_zoom() {
        for bad in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            for (content, view) in [
                (size(bad, 100.0), VIEW),
                (size(100.0, bad), VIEW),
                (WIDE, size(bad, 600.0)),
                (WIDE, size(800.0, bad)),
            ] {
                assert_eq!(fit(content, view), EMPTY);
                assert_eq!(zoomed(content, view, zoom(2.0, 10.0, 10.0)), EMPTY);
                assert_eq!(zoom_by(content, view, zoom(2.0, 10.0, 10.0), 2.0, 0.0, 0.0), UNZOOMED);
                assert_eq!(pan_by(content, view, zoom(2.0, 10.0, 10.0), 5.0, 5.0), UNZOOMED);
            }
        }
    }

    #[test]
    fn unzoomed_is_the_fit() {
        assert_eq!(zoomed(WIDE, VIEW, UNZOOMED), fit(WIDE, VIEW));
    }

    #[test]
    fn zoomed_scales_the_fit_around_the_view_centre_and_pans() {
        assert_eq!(zoomed(WIDE, VIEW, zoom(2.0, 0.0, 0.0)), rect(-400.0, -100.0, 1600.0, 800.0));
        assert_eq!(zoomed(WIDE, VIEW, zoom(2.0, 30.0, -20.0)), rect(-370.0, -120.0, 1600.0, 800.0));
    }

    #[test]
    fn zooming_at_the_centre_keeps_the_content_centred() {
        assert_eq!(zoom_by(WIDE, VIEW, UNZOOMED, ZOOM_STEP, 400.0, 300.0), zoom(ZOOM_STEP, 0.0, 0.0));
    }

    #[test]
    fn zooming_keeps_the_point_under_the_pointer() {
        // (600, 200) is 200 right of and 100 above the centre. At 2x, the
        // content point there would move to 400 right and 200 up, so the
        // pan brings it back by 200 and 100.
        let zoomed_in = zoom_by(WIDE, VIEW, UNZOOMED, 2.0, 600.0, 200.0);
        assert_eq!(zoomed_in, zoom(2.0, -200.0, 100.0));
        // Zooming back out at the same point undoes it.
        assert_eq!(zoom_by(WIDE, VIEW, zoomed_in, 0.5, 600.0, 200.0), UNZOOMED);
    }

    #[test]
    fn zooming_at_the_pointer_stays_within_the_pan_limits() {
        // At 2x the content is 1600 x 800 in an 800 x 600 view, so it pans
        // at most 400 sideways and 100 up or down.
        assert_eq!(zoom_by(WIDE, VIEW, UNZOOMED, 2.0, 800.0, 0.0), zoom(2.0, -400.0, 100.0));
    }

    #[test]
    fn zoom_stays_between_1x_and_10x() {
        assert_eq!(zoom_by(WIDE, VIEW, zoom(8.0, 0.0, 0.0), 2.0, 400.0, 300.0).scale, MAX_ZOOM);
        assert_eq!(zoom_by(WIDE, VIEW, zoom(1.2, 0.0, 0.0), 0.5, 400.0, 300.0), UNZOOMED);
    }

    #[test]
    fn stepping_in_and_back_out_returns_to_1x() {
        let mut current = UNZOOMED;
        for _ in 0..5 {
            current = zoom_by(WIDE, VIEW, current, ZOOM_STEP, 123.0, 456.0);
        }
        for _ in 0..5 {
            current = zoom_by(WIDE, VIEW, current, 1.0 / ZOOM_STEP, 321.0, 54.0);
        }
        assert_eq!(current, UNZOOMED);
    }

    #[test]
    fn a_bad_factor_changes_nothing() {
        let current = zoom(2.0, 100.0, 50.0);
        for bad in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert_eq!(zoom_by(WIDE, VIEW, current, bad, 400.0, 300.0), current);
        }
    }

    #[test]
    fn panning_stops_at_the_content_edges() {
        let current = zoom(2.0, 0.0, 0.0);
        assert_eq!(pan_by(WIDE, VIEW, current, 150.0, -60.0), zoom(2.0, 150.0, -60.0));
        assert_eq!(pan_by(WIDE, VIEW, current, 1000.0, -1000.0), zoom(2.0, 400.0, -100.0));
    }

    #[test]
    fn content_smaller_than_the_view_does_not_pan() {
        // At 1.2x the 800 x 400 fit is 960 x 480: wider than the view, but
        // not taller.
        assert_eq!(pan_by(WIDE, VIEW, zoom(1.2, 0.0, 0.0), 50.0, 50.0), zoom(1.2, 50.0, 0.0));
        assert_eq!(pan_by(WIDE, VIEW, UNZOOMED, 50.0, 50.0), UNZOOMED);
    }

    #[test]
    fn panning_by_nothing_brings_the_pan_back_after_a_resize() {
        let before = zoom(2.0, 400.0, 100.0);
        // A wider view fits the content as 1000 x 500; at 2x it pans 500
        // sideways and 200 up or down within 1000 x 600.
        assert_eq!(pan_by(WIDE, size(1000.0, 600.0), before, 0.0, 0.0), before);
        // A smaller view fits it as 400 x 200 in 400 x 600: 200 sideways,
        // none up or down.
        assert_eq!(pan_by(WIDE, size(400.0, 600.0), before, 0.0, 0.0), zoom(2.0, 200.0, 0.0));
    }

    #[test]
    fn a_wheel_notch_zooms_by_the_limit() {
        assert_eq!(wheel_zoom_factor(120.0), 1.576);
        assert_eq!(wheel_zoom_factor(-120.0), 1.0 / 1.576);
        assert_eq!(wheel_zoom_factor(24.0), 1.576);
    }

    #[test]
    fn a_small_wheel_turn_zooms_a_little() {
        assert_eq!(wheel_zoom_factor(5.0), 1.12);
        assert_eq!(wheel_zoom_factor(0.0), 1.0);
        assert_eq!(wheel_zoom_factor(f64::NAN), 1.0);
    }
}
