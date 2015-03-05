# Benchmarks #

Performs roughly the same as the built-in Node.js HTTP server currently.

*For some reason node does a better job with only 4 children.*

## Version 0.0.2-beta.4 ##
Quick test on a n1-highcpu-8 Google Compute Instance running Node v0.12.0 and 4 children.

    $ echo "{\"test\":true}" > send.txt
    $ ab -c 100 -n 10000 -p send.txt http://gobbler/
    Requests per second:    8757.82 [#/sec] (mean)
    Time per request:       11.418 [ms] (mean)
    Time per request:       0.114 [ms] (mean, across all concurrent requests)
    Transfer rate:          641.63 [Kbytes/sec] received
                            1182.73 kb/s sent
                            1824.37 kb/s total
    
    Connection Times (ms)
                  min  mean[+/-sd] median   max
    Connect:        0    1   1.7      1       8
    Processing:     0   10   6.6      8      48
    Waiting:        0    9   6.5      8      48
    Total:          0   11   6.3     11      48

Plain Node HTTP server on the same box. [See Script](https://gist.github.com/fastest963/145f72c21aedf620abce#file-manual-js)

    $ ab -c 100 -n 10000 -p send.txt http://gobbler/
    Requests per second:    8633.09 [#/sec] (mean)
    Time per request:       11.583 [ms] (mean)
    Time per request:       0.116 [ms] (mean, across all concurrent requests)
    Transfer rate:          633.63 [Kbytes/sec] received
                            1166.58 kb/s sent
                            1800.22 kb/s total
    
    Connection Times (ms)
                  min  mean[+/-sd] median   max
    Connect:        0    1   1.9      0       7
    Processing:     0   10   6.5      8      43
    Waiting:        0   10   6.5      8      42
    Total:          0   11   6.5     11      44

