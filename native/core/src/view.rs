//! View calculations shared by the UIs. Pure functions of sizes, in
//! whatever unit the caller uses; nothing is rounded or snapped.

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

const EMPTY: Rect = Rect { x: 0.0, y: 0.0, width: 0.0, height: 0.0 };

fn usable(size: f64) -> bool {
    size.is_finite() && size > 0.0
}

/// Where content is drawn in a view: scaled down to fit with its aspect
/// ratio kept, never scaled up (the Electron app's default, "native or
/// smaller"), and centred. Any size that is not finite and positive gives
/// an empty rect at the origin.
pub fn fit(content_width: f64, content_height: f64, view_width: f64, view_height: f64) -> Rect {
    if ![content_width, content_height, view_width, view_height].into_iter().all(usable) {
        return EMPTY;
    }
    let scale = (view_width / content_width).min(view_height / content_height).min(1.0);
    let width = content_width * scale;
    let height = content_height * scale;
    Rect { x: (view_width - width) / 2.0, y: (view_height - height) / 2.0, width, height }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect { x, y, width, height }
    }

    #[test]
    fn wider_than_the_view_fills_its_width() {
        assert_eq!(fit(2000.0, 1000.0, 800.0, 600.0), rect(0.0, 100.0, 800.0, 400.0));
    }

    #[test]
    fn taller_than_the_view_fills_its_height() {
        assert_eq!(fit(1000.0, 2000.0, 800.0, 600.0), rect(250.0, 0.0, 300.0, 600.0));
    }

    #[test]
    fn same_aspect_fills_the_view() {
        assert_eq!(fit(1600.0, 1200.0, 800.0, 600.0), rect(0.0, 0.0, 800.0, 600.0));
    }

    #[test]
    fn smaller_than_the_view_keeps_its_size() {
        assert_eq!(fit(200.0, 100.0, 800.0, 600.0), rect(300.0, 250.0, 200.0, 100.0));
    }

    #[test]
    fn degenerate_sizes_give_an_empty_rect() {
        for bad in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert_eq!(fit(bad, 100.0, 800.0, 600.0), EMPTY);
            assert_eq!(fit(100.0, bad, 800.0, 600.0), EMPTY);
            assert_eq!(fit(100.0, 100.0, bad, 600.0), EMPTY);
            assert_eq!(fit(100.0, 100.0, 800.0, bad), EMPTY);
        }
    }
}
