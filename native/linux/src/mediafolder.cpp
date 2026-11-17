#include "mediafolder.h"

#include <pixvitta.h>

#include <QFile>
#include <QFileInfo>

MediaFolder::MediaFolder(QObject *parent)
    : QObject(parent)
{
}

MediaFolder::~MediaFolder()
{
    pv_folder_release(m_folder);
}

bool MediaFolder::open(const QString &path)
{
    const QByteArray encoded = QFile::encodeName(path);
    pv_folder *folder = nullptr;
    const int status = pv_folder_open(encoded.constData(), &folder);
    if (status != PV_OK) {
        qCritical("Could not open %s: %s", encoded.constData(), pv_error_string(status));
        return false;
    }
    pv_folder_release(m_folder);
    m_folder = folder;
    m_index = 0;
    emit indexChanged();
    return true;
}

int MediaFolder::count() const
{
    return int(pv_folder_count(m_folder));
}

const char *MediaFolder::path() const
{
    return pv_folder_path(m_folder, size_t(m_index));
}

bool MediaFolder::isVideo() const
{
    return pv_folder_kind(m_folder, size_t(m_index)) == PV_MEDIA_VIDEO;
}

QString MediaFolder::pathId() const
{
    const char *current = path();
    return current ? QString::fromLatin1(QByteArray(current).toHex()) : QString();
}

QString MediaFolder::name() const
{
    const char *current = path();
    return current ? QFileInfo(QFile::decodeName(current)).fileName() : QString();
}

QByteArray MediaFolder::pathFromId(const QString &id)
{
    return QByteArray::fromHex(id.toLatin1());
}

void MediaFolder::next()
{
    setIndex(m_index + 1);
}

void MediaFolder::previous()
{
    setIndex(m_index - 1);
}

void MediaFolder::setIndex(int index)
{
    if (index < 0 || index >= count() || index == m_index)
        return;
    m_index = index;
    emit indexChanged();
}
