#pragma once

#include <QObject>
#include <QtQml/qqmlregistration.h>

struct pv_folder;

// The open folder and the current position in it.
//
// Files are named in QML by a path id: the path's bytes in hex. Linux paths
// are bytes, not text, so this survives names that aren't valid UTF-8.
class MediaFolder : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_UNCREATABLE("Created by main()")
    Q_PROPERTY(int count READ count CONSTANT)
    Q_PROPERTY(int index READ index NOTIFY indexChanged)
    Q_PROPERTY(bool isVideo READ isVideo NOTIFY indexChanged)
    Q_PROPERTY(QString pathId READ pathId NOTIFY indexChanged)
    Q_PROPERTY(QString name READ name NOTIFY indexChanged)

public:
    explicit MediaFolder(QObject *parent = nullptr);
    ~MediaFolder() override;

    bool open(const QString &path);

    int count() const;
    int index() const { return m_index; }
    bool isVideo() const;
    QString pathId() const;
    QString name() const;

    Q_INVOKABLE void next();
    Q_INVOKABLE void previous();

    static QByteArray pathFromId(const QString &id);

signals:
    void indexChanged();

private:
    void setIndex(int index);
    const char *path() const;

    pv_folder *m_folder = nullptr;
    int m_index = 0;
};
