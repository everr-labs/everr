package atomicfile

import (
	"os"
	"path/filepath"
)

// Write fills dest through a synced temp file in the same directory and
// renames it into place, so a crash leaves either the old file or the
// complete new one, never a truncated one.
func Write(dest string, perm os.FileMode, write func(*os.File) error) error {
	file, err := os.CreateTemp(filepath.Dir(dest), ".tmp")
	if err != nil {
		return err
	}
	tmp := file.Name()
	err = file.Chmod(perm)
	if err == nil {
		err = write(file)
	}
	if err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(tmp, dest)
	}
	if err != nil {
		_ = os.Remove(tmp)
	}
	return err
}

// WriteFile is Write for contents already in memory.
func WriteFile(dest string, data []byte, perm os.FileMode) error {
	return Write(dest, perm, func(file *os.File) error {
		_, err := file.Write(data)
		return err
	})
}
