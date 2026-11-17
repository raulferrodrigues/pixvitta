#pragma once

#include <QImage>
#include <QQuickItem>
#include <QTimer>
#include <QtQml/qqmlregistration.h>

#include <pixvitta.h>

#include <memory>

// A QML item that shows an image from the core, fitted to the item, and
// plays it if it is animated. Frames are decoded on a worker thread, one
// ahead of the one on screen; each is shown for as long as the core says.
// It can be zoomed and panned; QML forwards the gestures, the core keeps
// them within its limits, and a new source starts unzoomed.
class ImageItem : public QQuickItem
{
    Q_OBJECT
    QML_ELEMENT
    // A MediaFolder path id; empty shows nothing.
    Q_PROPERTY(QString source READ source WRITE setSource NOTIFY sourceChanged)
    // Zoomed in past the fit, so dragging and the wheel pan.
    Q_PROPERTY(bool zoomed READ zoomed NOTIFY zoomedChanged)

public:
    explicit ImageItem(QQuickItem *parent = nullptr);
    ~ImageItem() override;

    QString source() const { return m_source; }
    void setSource(const QString &source);
    bool zoomed() const { return m_zoom.scale > 1; }

    // Zoom by one step around the item's centre.
    Q_INVOKABLE void zoomIn();
    Q_INVOKABLE void zoomOut();
    // Zoom for a wheel turn of `delta` pixels (positive zooms in) around the
    // point (x, y) of the item.
    Q_INVOKABLE void wheelZoom(qreal delta, qreal x, qreal y);
    Q_INVOKABLE void panBy(qreal dx, qreal dy);

signals:
    void sourceChanged();
    void zoomedChanged();

protected:
    QSGNode *updatePaintNode(QSGNode *oldNode, UpdatePaintNodeData *) override;
    void geometryChange(const QRectF &newGeometry, const QRectF &oldGeometry) override;

private:
    struct Playback;

    void stop();
    void decodeNext();
    void frameDecoded(const std::shared_ptr<Playback> &playback, const QImage &frame, int duration);
    void showPending();
    pv_size contentSize() const;
    void setZoom(const pv_zoom &zoom);

    QString m_source;
    std::shared_ptr<Playback> m_playback;
    QTimer m_timer;
    QImage m_frame;
    bool m_frameChanged = false;
    QImage m_pending;
    int m_pendingDuration = 0;
    // The frame on screen has had its time.
    bool m_due = false;
    pv_zoom m_zoom = {1, 0, 0};
};
