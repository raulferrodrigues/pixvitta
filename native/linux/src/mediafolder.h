#pragma once

#include <QObject>
#include <QtQml/qqmlregistration.h>

struct pv_folder;

// The open folder and the current position in it. Starts with no folder
// until open() or choose().
//
// Files are named in QML by a path id: the path's bytes in hex. Linux paths
// are bytes, not text, so this survives names that aren't valid UTF-8.
class MediaFolder : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_UNCREATABLE("Created by main()")
    Q_PROPERTY(bool isOpen READ isOpen NOTIFY folderChanged)
    Q_PROPERTY(int count READ count NOTIFY folderChanged)
    Q_PROPERTY(QString error READ error NOTIFY folderChanged)
    Q_PROPERTY(int index READ index NOTIFY indexChanged)
    Q_PROPERTY(bool isVideo READ isVideo NOTIFY indexChanged)
    Q_PROPERTY(QString pathId READ pathId NOTIFY indexChanged)
    Q_PROPERTY(QString name READ name NOTIFY indexChanged)

public:
    explicit MediaFolder(QObject *parent = nullptr);
    ~MediaFolder() override;

    bool open(const QString &path);

    bool isOpen() const { return m_folder != nullptr; }
    int count() const;
    QString error() const { return m_error; }
    int index() const { return m_index; }
    bool isVideo() const;
    QString pathId() const;
    QString name() const;

    Q_INVOKABLE void next();
    Q_INVOKABLE void previous();
    // Asks for a folder with the system's folder dialog and opens it.
    Q_INVOKABLE void choose();

    static QByteArray pathFromId(const QString &id);

signals:
    void folderChanged();
    void indexChanged();

private:
    void setIndex(int index);
    const char *path() const;

    pv_folder *m_folder = nullptr;
    QString m_path;
    QString m_error;
    int m_index = 0;
};
