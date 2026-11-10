#include "imageitem.h"

#include "mediafolder.h"

#include <pixvitta.h>

#include <QMutex>
#include <QQuickWindow>
#include <QSGImageNode>
#include <QThreadPool>

#include <utility>

// Shared by the item and the decode job in flight, so the core's animation
// lives until both are done with it. One job runs at a time.
struct ImageItem::Playback
{
    ~Playback() { pv_animation_release(animation); }

    QByteArray path;
    pv_animation *animation = nullptr;
    // Cleared when the item moves on, so a job that finishes late never
    // reaches an item that is gone.
    QMutex mutex;
    ImageItem *item = nullptr;
};

ImageItem::ImageItem(QQuickItem *parent)
    : QQuickItem(parent)
{
    setFlag(ItemHasContents);
    m_timer.setSingleShot(true);
    m_timer.setTimerType(Qt::PreciseTimer);
    connect(&m_timer, &QTimer::timeout, this, [this] {
        m_due = true;
        showPending();
    });
}

ImageItem::~ImageItem()
{
    stop();
}

void ImageItem::setSource(const QString &source)
{
    if (source == m_source)
        return;
    m_source = source;
    stop();
    m_frame = QImage();
    m_frameChanged = true;
    update();
    if (!source.isEmpty()) {
        m_playback = std::make_shared<Playback>();
        m_playback->path = MediaFolder::pathFromId(source);
        m_playback->item = this;
        m_due = true;
        decodeNext();
    }
    emit sourceChanged();
}

void ImageItem::stop()
{
    m_timer.stop();
    m_pending = QImage();
    m_due = false;
    if (m_playback) {
        QMutexLocker lock(&m_playback->mutex);
        m_playback->item = nullptr;
    }
    m_playback.reset();
}

void ImageItem::decodeNext()
{
    QThreadPool::globalInstance()->start([playback = m_playback] {
        if (!playback->animation) {
            const int status = pv_animation_open(playback->path.constData(), &playback->animation);
            if (status != PV_OK) {
                qWarning("Could not open %s: %s", playback->path.constData(), pv_error_string(status));
                return;
            }
        }
        pv_image *image = nullptr;
        uint32_t duration = 0;
        const int status = pv_animation_next_frame(playback->animation, &image, &duration);
        if (status != PV_OK) {
            qWarning("Could not decode %s: %s", playback->path.constData(), pv_error_string(status));
            return;
        }
        // No copy: the QImage reads the core's buffer and hands it back to
        // the core once Qt is done with it.
        const QImage frame(
            image->pixels, int(image->width), int(image->height), qsizetype(image->stride),
            QImage::Format_RGBA8888, [](void *info) { pv_image_release(static_cast<pv_image *>(info)); },
            image);
        QMutexLocker lock(&playback->mutex);
        if (playback->item) {
            QMetaObject::invokeMethod(
                playback->item,
                [item = playback->item, playback, frame, duration] {
                    item->frameDecoded(playback, frame, int(duration));
                },
                Qt::QueuedConnection);
        }
    });
}

void ImageItem::frameDecoded(const std::shared_ptr<Playback> &playback, const QImage &frame, int duration)
{
    // A frame of a file the item has already left.
    if (playback != m_playback)
        return;
    m_pending = frame;
    m_pendingDuration = duration;
    showPending();
}

void ImageItem::showPending()
{
    if (!m_due || m_pending.isNull())
        return;
    m_frame = std::exchange(m_pending, QImage());
    m_frameChanged = true;
    m_due = false;
    update();
    // A still has no duration and nothing more to decode.
    if (m_pendingDuration > 0) {
        m_timer.start(m_pendingDuration);
        decodeNext();
    }
}

QSGNode *ImageItem::updatePaintNode(QSGNode *oldNode, UpdatePaintNodeData *)
{
    auto *node = static_cast<QSGImageNode *>(oldNode);
    if (m_frame.isNull()) {
        delete node;
        return nullptr;
    }
    if (!node) {
        node = window()->createImageNode();
        node->setOwnsTexture(true);
        // Smooth and mipmapped, as an Image with smooth and mipmap set.
        node->setFiltering(QSGTexture::Linear);
        node->setMipmapFiltering(QSGTexture::Linear);
        m_frameChanged = true;
    }
    if (m_frameChanged) {
        node->setTexture(window()->createTextureFromImage(m_frame));
        m_frameChanged = false;
    }
    // Fitted to the item, keeping the aspect ratio, centred.
    const QSizeF size = QSizeF(m_frame.size()).scaled(this->size(), Qt::KeepAspectRatio);
    node->setRect(QRectF(QPointF((width() - size.width()) / 2, (height() - size.height()) / 2), size));
    return node;
}

void ImageItem::geometryChange(const QRectF &newGeometry, const QRectF &oldGeometry)
{
    QQuickItem::geometryChange(newGeometry, oldGeometry);
    update();
}
