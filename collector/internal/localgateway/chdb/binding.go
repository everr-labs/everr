package chdb

// Minimal purego binding for libchdb's connection API, adapted from
// github.com/chdb-io/chdb-go (Apache-2.0, Copyright 2023 chDB, Inc.).
// chdb-go dlopens the library from a package init and panics when it is
// missing, which makes it unusable in binaries that only sometimes need chDB.
// This binding loads the library on the first Open instead.

import (
	"errors"
	"fmt"
	"os"
	"sync"
	"unsafe"

	"github.com/ebitengine/purego"
)

// LibraryPathEnv names the libchdb shared library to load when Open is not
// given an explicit path.
const LibraryPathEnv = "CHDB_LIB_PATH"

type cConnection struct {
	internalData unsafe.Pointer
}

// cResult is opaque; libchdb only hands out pointers to it.
type cResult struct {
	_ unsafe.Pointer
}

var (
	chdbConnect            func(argc int, argv []*byte) *cConnection
	chdbCloseConn          func(conn *cConnection)
	chdbQuery              func(conn unsafe.Pointer, query string, format string) *cResult
	chdbDestroyQueryResult func(result *cResult)
	chdbResultBuffer       func(result *cResult) *byte
	chdbResultLen          func(result *cResult) uint
	chdbResultError        func(result *cResult) string
)

var library struct {
	once sync.Once
	path string
	err  error
}

// loadLibrary dlopens libchdb once per process. A process can only host one
// chDB engine, so later calls with a different path fail instead of loading a
// second copy.
func loadLibrary(path string) error {
	if path == "" {
		path = os.Getenv(LibraryPathEnv)
	}
	if path == "" {
		return fmt.Errorf("libchdb path required: pass WithLibraryPath or set %s", LibraryPathEnv)
	}
	library.once.Do(func() {
		library.path = path
		lib, err := purego.Dlopen(path, purego.RTLD_NOW|purego.RTLD_GLOBAL)
		if err != nil {
			library.err = fmt.Errorf("load libchdb %s: %w", path, err)
			return
		}
		purego.RegisterLibFunc(&chdbConnect, lib, "chdb_connect")
		purego.RegisterLibFunc(&chdbCloseConn, lib, "chdb_close_conn")
		purego.RegisterLibFunc(&chdbQuery, lib, "chdb_query")
		purego.RegisterLibFunc(&chdbDestroyQueryResult, lib, "chdb_destroy_query_result")
		purego.RegisterLibFunc(&chdbResultBuffer, lib, "chdb_result_buffer")
		purego.RegisterLibFunc(&chdbResultLen, lib, "chdb_result_length")
		purego.RegisterLibFunc(&chdbResultError, lib, "chdb_result_error")
	})
	if library.err != nil {
		return library.err
	}
	if library.path != path {
		return fmt.Errorf("libchdb already loaded from %s", library.path)
	}
	return nil
}

type libSession struct {
	path string
	conn *cConnection
}

func newLibSession(libraryPath, dataPath string) (Session, error) {
	if err := loadLibrary(libraryPath); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dataPath, 0o755); err != nil {
		return nil, fmt.Errorf("create chdb directory %s: %w", dataPath, err)
	}
	argv := []string{"clickhouse", "--path=" + dataPath}
	cArgv := make([]*byte, len(argv))
	for i, arg := range argv {
		bytes := append([]byte(arg), 0)
		cArgv[i] = &bytes[0]
	}
	var conn *cConnection
	var connectErr error
	func() {
		defer func() {
			if r := recover(); r != nil {
				connectErr = fmt.Errorf("chdb connect: %v", r)
			}
		}()
		conn = chdbConnect(len(cArgv), cArgv)
	}()
	if connectErr != nil {
		return nil, connectErr
	}
	if conn == nil {
		return nil, errors.New("could not create a chdb connection")
	}
	return &libSession{path: dataPath, conn: conn}, nil
}

func (s *libSession) Query(query string, outputFormats ...string) (Result, error) {
	if s.conn == nil {
		return nil, ErrClosed
	}
	format := "CSV"
	if len(outputFormats) > 0 {
		format = outputFormats[0]
	}
	res := chdbQuery(s.conn.internalData, query, format)
	if res == nil {
		return &libResult{}, nil
	}
	if msg := chdbResultError(res); msg != "" {
		chdbDestroyQueryResult(res)
		return nil, errors.New(msg)
	}
	return &libResult{res: res}, nil
}

func (s *libSession) Close() {
	if s.conn != nil {
		chdbCloseConn(s.conn)
		s.conn = nil
	}
}

func (s *libSession) Path() string { return s.path }

type libResult struct {
	res *cResult
}

func (r *libResult) Buf() []byte {
	if r.res == nil {
		return nil
	}
	buf := chdbResultBuffer(r.res)
	if buf == nil {
		return nil
	}
	return unsafe.Slice(buf, int(chdbResultLen(r.res)))
}

func (r *libResult) Free() {
	if r.res != nil {
		chdbDestroyQueryResult(r.res)
		r.res = nil
	}
}
