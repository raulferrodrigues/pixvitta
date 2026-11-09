#include "videoitem.h"

#include "mediafolder.h"

#include <pixvitta.h>

#include <QOpenGLContext>
#include <QOpenGLFramebufferObject>
#include <QQuickOpenGLUtils>

namespace {

void *getProcAddress(void *, const char *name)
{
    QOpenGLContext *context = QOpenGLContext::currentContext();
    return context ? reinterpret_cast<void *>(context->getProcAddress(name)) : nullptr;
}

// Lives on the render thread. Its core renderer keeps libmpv alive until Qt
// deletes it there, with the OpenGL context current, even if the item has
// already gone.
class VideoRenderer : public QQuickFramebufferObject::Renderer
{
public:
    ~VideoRenderer() override { pv_video_renderer_destroy(m_renderer); }

    void synchronize(QQuickFramebufferObject *item) override
    {
        // The render context is created here, on the render thread with the
        // context current, the first time the item is drawn.
        pv_player *player = static_cast<VideoItem *>(item)->player();
        if (!m_renderer && player) {
            const int status = pv_video_renderer_create(player, getProcAddress, nullptr, &m_renderer);
            if (status != PV_OK)
                qWarning("Could not create the video renderer: %s", pv_error_string(status));
        }
    }

    QOpenGLFramebufferObject *createFramebufferObject(const QSize &size) override
    {
        return new QOpenGLFramebufferObject(size);
    }

    void render() override
    {
        if (!m_renderer)
            return;
        // libmpv expects default OpenGL state, not whatever Qt left bound.
        QQuickOpenGLUtils::resetOpenGLState();
        QOpenGLFramebufferObject *fbo = framebufferObject();
        pv_video_renderer_render(m_renderer, int(fbo->handle()), fbo->width(), fbo->height(), false);
        QQuickOpenGLUtils::resetOpenGLState();
    }

private:
    pv_video_renderer *m_renderer = nullptr;
};

} // namespace

VideoItem::VideoItem(QQuickItem *parent)
    : QQuickFramebufferObject(parent)
{
    const int status = pv_player_create(&m_player);
    if (status != PV_OK) {
        qWarning("Could not start the video player: %s", pv_error_string(status));
        return;
    }
    // The core's wake-up callback runs on libmpv's threads. It only asks the
    // GUI thread for a redraw, which in turn has Qt call render().
    pv_player_set_wakeup_callback(
        m_player,
        [](void *ctx) {
            QMetaObject::invokeMethod(static_cast<VideoItem *>(ctx), &QQuickItem::update,
                                      Qt::QueuedConnection);
        },
        this);
}

VideoItem::~VideoItem()
{
    pv_player_destroy(m_player);
}

QQuickFramebufferObject::Renderer *VideoItem::createRenderer() const
{
    return new VideoRenderer;
}

void VideoItem::setSource(const QString &source)
{
    if (source == m_source)
        return;
    m_source = source;
    if (m_player) {
        if (source.isEmpty())
            pv_player_stop(m_player);
        else
            pv_player_load(m_player, MediaFolder::pathFromId(source).constData());
    }
    emit sourceChanged();
    // A new file starts playing.
    if (m_paused) {
        m_paused = false;
        emit pausedChanged();
    }
}

void VideoItem::setPaused(bool paused)
{
    if (paused == m_paused)
        return;
    m_paused = paused;
    if (m_player)
        pv_player_set_paused(m_player, paused);
    emit pausedChanged();
}
