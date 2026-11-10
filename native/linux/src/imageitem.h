#pragma once

#include <QImage>
#include <QQuickItem>
#include <QTimer>
#include <QtQml/qqmlregistration.h>

#include <memory>

// A QML item that shows an image from the core, fitted to the item, and
// plays it if it is animated. Frames are decoded on Qt's thread pool, one
// ahead of the one on screen; each is shown for as long as the core says.
class ImageItem : public QQuickItem
{
    Q_OBJECT
    QML_ELEMENT
    // A MediaFolder path id; empty shows nothing.
    Q_PROPERTY(QString source READ source WRITE setSource NOTIFY sourceChanged)

public:
    explicit ImageItem(QQuickItem *parent = nullptr);
    ~ImageItem() override;

    QString source() const { return m_source; }
    void setSource(const QString &source);

signals:
    void sourceChanged();

protected:
    QSGNode *updatePaintNode(QSGNode *oldNode, UpdatePaintNodeData *) override;
    void geometryChange(const QRectF &newGeometry, const QRectF &oldGeometry) override;

private:
    struct Playback;

    void stop();
    void decodeNext();
    void frameDecoded(const std::shared_ptr<Playback> &playback, const QImage &frame, int duration);
    void showPending();

    QString m_source;
    std::shared_ptr<Playback> m_playback;
    QTimer m_timer;
    QImage m_frame;
    bool m_frameChanged = false;
    QImage m_pending;
    int m_pendingDuration = 0;
    // The frame on screen has had its time.
    bool m_due = false;
};
